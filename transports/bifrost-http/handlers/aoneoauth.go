package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/fasthttp/router"
	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/aoneoauth"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

const (
	aoneOAuthStateTTL        = 10 * time.Minute
	defaultAoneOAuthReturnTo = "/workspace"
)

type aoneOAuthStateEntry struct {
	state     string
	returnTo  string
	expiresAt time.Time
}

// AoneOAuthStateStore stores short-lived CSRF state tokens for the Aone OAuth flow.
type AoneOAuthStateStore struct {
	mu       sync.Mutex
	entries  map[string]aoneOAuthStateEntry
	done     chan struct{}
	stopOnce sync.Once
}

// NewAoneOAuthStateStore creates a state store and starts background cleanup.
func NewAoneOAuthStateStore() *AoneOAuthStateStore {
	s := &AoneOAuthStateStore{
		entries: make(map[string]aoneOAuthStateEntry),
		done:    make(chan struct{}),
	}
	go s.cleanup()
	return s
}

func (s *AoneOAuthStateStore) Issue(returnTo string) (string, error) {
	state, err := randomAoneOAuthState()
	if err != nil {
		return "", err
	}
	if returnTo == "" {
		returnTo = defaultAoneOAuthReturnTo
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[state] = aoneOAuthStateEntry{
		state:     state,
		returnTo:  returnTo,
		expiresAt: time.Now().Add(aoneOAuthStateTTL),
	}
	return state, nil
}

func (s *AoneOAuthStateStore) Consume(state string) (string, bool) {
	if state == "" {
		return "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.entries[state]
	if !ok {
		return "", false
	}
	delete(s.entries, state)
	if entry.expiresAt.Before(time.Now()) {
		return "", false
	}
	return entry.returnTo, true
}

func (s *AoneOAuthStateStore) cleanup() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-ticker.C:
			now := time.Now()
			s.mu.Lock()
			for key, entry := range s.entries {
				if entry.expiresAt.Before(now) {
					delete(s.entries, key)
				}
			}
			s.mu.Unlock()
		}
	}
}

func (s *AoneOAuthStateStore) Stop() {
	s.stopOnce.Do(func() {
		close(s.done)
	})
}

func randomAoneOAuthState() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// AoneOAuthHandler manages dashboard login via external Aone OAuth2.
type AoneOAuthHandler struct {
	configStore configstore.ConfigStore
	stateStore  *AoneOAuthStateStore
	vkReloader  VirtualKeyReloader
}

// NewAoneOAuthHandler creates a new Aone OAuth handler.
func NewAoneOAuthHandler(configStore configstore.ConfigStore, stateStore *AoneOAuthStateStore, vkReloader VirtualKeyReloader) *AoneOAuthHandler {
	return &AoneOAuthHandler{
		configStore: configStore,
		stateStore:  stateStore,
		vkReloader:  vkReloader,
	}
}

// RegisterRoutes registers Aone OAuth routes.
func (h *AoneOAuthHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	r.GET("/api/aone/oauth/config", lib.ChainMiddlewares(h.getConfig, middlewares...))
	r.GET("/api/aone/oauth/authorize", lib.ChainMiddlewares(h.authorize, middlewares...))
	r.GET("/api/aone/oauth/callback", lib.ChainMiddlewares(h.callback, middlewares...))
}

func (h *AoneOAuthHandler) getConfig(ctx *fasthttp.RequestCtx) {
	cfg, err := h.loadConfiguredAoneOAuth(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to load Aone OAuth config: %v", err))
		return
	}
	if cfg == nil {
		SendJSON(ctx, map[string]any{
			"enabled": false,
		})
		return
	}
	SendJSON(ctx, map[string]any{
		"enabled": true,
	})
}

func (h *AoneOAuthHandler) authorize(ctx *fasthttp.RequestCtx) {
	cfg, err := h.loadConfiguredAoneOAuth(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to load Aone OAuth config: %v", err))
		return
	}
	if cfg == nil {
		SendError(ctx, fasthttp.StatusForbidden, "Aone OAuth is not configured")
		return
	}

	state, err := h.stateStore.Issue(parseAoneOAuthReturnTo(string(ctx.QueryArgs().Peek("return_to")), cfg.RedirectURI.GetValue()))
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to initiate OAuth flow")
		return
	}

	client := aoneoauth.NewClient(cfg.BaseURL.GetValue())
	authorizeURL := client.AuthorizeURL(
		cfg.ClientID.GetValue(),
		cfg.RedirectURI.GetValue(),
		state,
	)
	ctx.Redirect(authorizeURL, fasthttp.StatusFound)
}

func (h *AoneOAuthHandler) callback(ctx *fasthttp.RequestCtx) {
	state := string(ctx.QueryArgs().Peek("state"))
	returnTo, stateValid := h.stateStore.Consume(state)
	if !stateValid {
		ctx.Redirect(aoneOAuthLoginRedirect("", "Invalid or expired OAuth state"), fasthttp.StatusFound)
		return
	}

	errorParam := string(ctx.QueryArgs().Peek("error"))
	if errorParam != "" {
		errorDescription := string(ctx.QueryArgs().Peek("error_description"))
		logger.Warn("[aone-oauth] upstream callback error: error=%s description=%s", errorParam, errorDescription)
		ctx.Redirect(aoneOAuthLoginRedirect(returnTo, "Aone authentication was denied or failed"), fasthttp.StatusFound)
		return
	}

	code := string(ctx.QueryArgs().Peek("code"))
	if code == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Missing required parameter: code")
		return
	}

	cfg, err := h.loadConfiguredAoneOAuth(ctx)
	if err != nil {
		logger.Error("[aone-oauth] failed to load config during callback: %v", err)
		ctx.Redirect(aoneOAuthLoginRedirect(returnTo, "Aone OAuth is not configured"), fasthttp.StatusFound)
		return
	}
	if cfg == nil {
		ctx.Redirect(aoneOAuthLoginRedirect(returnTo, "Aone OAuth is not configured"), fasthttp.StatusFound)
		return
	}

	client := aoneoauth.NewClient(cfg.BaseURL.GetValue())
	tokenResp, err := client.ExchangeAuthorizationCode(
		ctx,
		code,
		cfg.ClientID.GetValue(),
		cfg.ClientSecret.GetValue(),
		cfg.RedirectURI.GetValue(),
	)
	if err != nil {
		logger.Error("[aone-oauth] token exchange failed: %v", err)
		ctx.Redirect(aoneOAuthLoginRedirect(returnTo, "Failed to exchange authorization code"), fasthttp.StatusFound)
		return
	}

	meResp, err := client.GetMe(ctx, tokenResp.AccessToken)
	var aoneUserID string
	if err != nil {
		logger.Warn("[aone-oauth] failed to fetch user profile after token exchange: %v", err)
	} else if meResp != nil && h.configStore != nil {
		user, upsertErr := h.configStore.UpsertAoneUserFromLogin(ctx, meResp)
		if upsertErr != nil {
			if errors.Is(upsertErr, configstore.ErrAoneUserDisabled) {
				ctx.Redirect(aoneOAuthLoginRedirect(returnTo, "Your account has been disabled"), fasthttp.StatusFound)
				return
			}
			logger.Warn("[aone-oauth] failed to upsert user profile: %v", upsertErr)
		} else if user != nil {
			aoneUserID = user.AoneUserID
			if vk, vkErr := h.configStore.EnsureAoneUserVirtualKey(ctx, user.AoneUserID); vkErr != nil {
				logger.Warn("[aone-oauth] failed to ensure user virtual key: %v", vkErr)
			} else if vk != nil && h.vkReloader != nil {
				if _, reloadErr := h.vkReloader.ReloadVirtualKey(ctx, vk.ID); reloadErr != nil {
					logger.Warn("[aone-oauth] failed to reload user virtual key: %v", reloadErr)
				} else {
					MarkAoneVirtualKeyReloaded(vk.ID)
				}
			}
		}
	}

	if err := h.createDashboardSession(ctx, aoneUserID); err != nil {
		logger.Error("[aone-oauth] failed to create dashboard session: %v", err)
		ctx.Redirect(aoneOAuthLoginRedirect(returnTo, "Failed to create session"), fasthttp.StatusFound)
		return
	}

	ctx.Redirect(returnTo, fasthttp.StatusFound)
}

func (h *AoneOAuthHandler) loadConfiguredAoneOAuth(ctx *fasthttp.RequestCtx) (*configstore.AoneOAuthConfig, error) {
	if h.configStore == nil {
		return nil, nil
	}
	authConfig, err := h.configStore.GetAuthConfig(ctx)
	if err != nil {
		return nil, err
	}
	if authConfig == nil || !authConfig.IsEnabled || authConfig.AoneOAuth == nil || !authConfig.AoneOAuth.IsConfigured() {
		return nil, nil
	}
	return authConfig.AoneOAuth, nil
}

func (h *AoneOAuthHandler) createDashboardSession(ctx *fasthttp.RequestCtx, aoneUserID string) error {
	token := uuid.New().String()
	session := &tables.SessionsTable{
		Token:     token,
		ExpiresAt: time.Now().Add(time.Hour * 24 * 30),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if aoneUserID != "" {
		session.AoneUserID = &aoneUserID
	}
	if err := h.configStore.CreateSession(ctx, session); err != nil {
		return err
	}
	setSessionCookie(ctx, token, session.ExpiresAt)
	return nil
}

func setSessionCookie(ctx *fasthttp.RequestCtx, token string, expiresAt time.Time) {
	cookie := fasthttp.AcquireCookie()
	defer fasthttp.ReleaseCookie(cookie)
	cookie.SetKey("token")
	cookie.SetValue(token)
	cookie.SetExpire(expiresAt)
	cookie.SetPath("/")
	cookie.SetHTTPOnly(true)
	cookie.SetSameSite(fasthttp.CookieSameSiteLaxMode)
	if string(ctx.Request.Header.Peek("X-Forwarded-Proto")) == "https" {
		cookie.SetSecure(true)
	}
	ctx.Response.Header.SetCookie(cookie)
}

func dashboardAuthTypeFromConfig(authConfig *configstore.AuthConfig) string {
	if authConfig == nil || !authConfig.IsEnabled {
		return "none"
	}
	if authConfig.AoneOAuth != nil && authConfig.AoneOAuth.IsConfigured() {
		return "sso"
	}
	return "password"
}

func aoneOAuthEnabled(authConfig *configstore.AuthConfig) bool {
	return authConfig != nil && authConfig.AoneOAuth != nil && authConfig.AoneOAuth.IsConfigured()
}

func parseAoneOAuthReturnTo(raw, redirectURI string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return defaultAoneOAuthReturnTo
	}
	if strings.HasPrefix(raw, "/") {
		if isAllowedAoneOAuthReturnPath(raw) {
			return raw
		}
		return defaultAoneOAuthReturnTo
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return defaultAoneOAuthReturnTo
	}
	if !isAllowedAoneOAuthReturnPath(parsed.Path) {
		return defaultAoneOAuthReturnTo
	}
	if strings.EqualFold(parsed.Hostname(), "localhost") {
		return parsed.String()
	}
	redirect, err := url.Parse(redirectURI)
	if err != nil || redirect.Host == "" {
		return defaultAoneOAuthReturnTo
	}
	if strings.EqualFold(parsed.Hostname(), redirect.Hostname()) {
		return parsed.String()
	}
	return defaultAoneOAuthReturnTo
}

func validateAoneOAuthReturnPath(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return defaultAoneOAuthReturnTo, true
	}
	if strings.HasPrefix(raw, "/") {
		if isAllowedAoneOAuthReturnPath(raw) {
			return raw, true
		}
		return "", false
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", false
	}
	if !isAllowedAoneOAuthReturnPath(parsed.Path) {
		return "", false
	}
	return parsed.String(), true
}

func isAllowedAoneOAuthReturnPath(path string) bool {
	return path == defaultAoneOAuthReturnTo ||
		strings.HasPrefix(path, defaultAoneOAuthReturnTo+"/") ||
		strings.HasPrefix(path, defaultAoneOAuthReturnTo+"?") ||
		strings.HasPrefix(path, defaultAoneOAuthReturnTo+"#")
}

func aoneOAuthLoginRedirect(returnTo, message string) string {
	if parsed, ok := validateAoneOAuthReturnPath(returnTo); ok {
		if u, err := url.Parse(parsed); err == nil && u.Scheme != "" && u.Host != "" {
			u.Path = "/login"
			u.RawQuery = "error=" + url.QueryEscape(message)
			u.Fragment = ""
			return u.String()
		}
	}
	return "/login?error=" + url.QueryEscape(message)
}
