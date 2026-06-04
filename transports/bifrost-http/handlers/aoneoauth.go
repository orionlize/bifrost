package handlers

import (
	"crypto/rand"
	"encoding/base64"
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
	aoneOAuthStateTTL         = 10 * time.Minute
	defaultAoneOAuthReturnTo  = "/workspace"
	postLoginRedirectQueryKey = "post_login_redirect"
	loginSourceZdSwitch       = "zd-switch"
	// loginSourceDashboard is the login source recorded for regular dashboard
	// (browser) Aone OAuth logins. It keys the stored OAuth token row used for
	// server-side refresh.
	loginSourceDashboard = "dashboard"
	// defaultAoneSessionTTL bounds a dashboard session when the OAuth token
	// response omits expires_in. The session is still refreshed server-side via
	// the refresh token before it lapses.
	defaultAoneSessionTTL = 12 * time.Hour
	// adminSessionTTL makes local-admin sessions effectively non-expiring. The
	// admin is only logged out on explicit logout (or when all sessions are flushed).
	adminSessionTTL = 100 * 365 * 24 * time.Hour
	zdSwitchOAuthCallbackPath = "/api/aone/oauth/zd-switch/callback"
	loginZdSwitchSuccessPath  = "/login/zd-switch/success"
	zdSwitchDeeplinkHost      = "open"
	zdSwitchBaseURLQueryKey   = "base_url"
)

type aoneOAuthStateEntry struct {
	state            string
	returnTo         string
	redirectURI      string
	oauthRedirectURI string
	loginSource      string
	dashboardOrigin  string
	expiresAt        time.Time
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

func (s *AoneOAuthStateStore) Issue(returnTo, redirectURI, oauthRedirectURI, loginSource, dashboardOrigin string) (string, error) {
	nonce, err := randomAoneOAuthState()
	if err != nil {
		return "", err
	}
	if returnTo == "" {
		returnTo = defaultAoneOAuthReturnTo
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[nonce] = aoneOAuthStateEntry{
		state:            nonce,
		returnTo:         returnTo,
		redirectURI:      redirectURI,
		oauthRedirectURI: oauthRedirectURI,
		loginSource:      loginSource,
		dashboardOrigin:  dashboardOrigin,
		expiresAt:        time.Now().Add(aoneOAuthStateTTL),
	}
	return encodeAoneOAuthState(nonce, redirectURI), nil
}

func (s *AoneOAuthStateStore) Consume(state string) (returnTo, redirectURI, oauthRedirectURI, loginSource, dashboardOrigin string, ok bool) {
	nonce, embeddedRedirectURI := decodeAoneOAuthState(state)
	if nonce == "" {
		return "", "", "", "", "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, exists := s.entries[nonce]
	if !exists {
		if embeddedRedirectURI != "" {
			return loginCompleteReturnToForRedirectURI(embeddedRedirectURI, ""), embeddedRedirectURI, "", "", "", true
		}
		return "", "", "", "", "", false
	}
	delete(s.entries, nonce)
	if entry.expiresAt.Before(time.Now()) {
		return "", "", "", "", "", false
	}
	redirectURI = entry.redirectURI
	if redirectURI == "" {
		redirectURI = embeddedRedirectURI
	}
	return entry.returnTo, redirectURI, entry.oauthRedirectURI, entry.loginSource, entry.dashboardOrigin, true
}

func encodeAoneOAuthState(nonce, redirectURI string) string {
	redirectURI = validateLoginRedirectURI(redirectURI, "")
	if redirectURI == "" {
		return nonce
	}
	return nonce + "." + base64.RawURLEncoding.EncodeToString([]byte(redirectURI))
}

func decodeAoneOAuthState(state string) (nonce, redirectURI string) {
	state = strings.TrimSpace(state)
	if state == "" {
		return "", ""
	}
	idx := strings.Index(state, ".")
	if idx <= 0 {
		return state, ""
	}
	nonce = state[:idx]
	decoded, err := base64.RawURLEncoding.DecodeString(state[idx+1:])
	if err != nil {
		return nonce, ""
	}
	return nonce, validateLoginRedirectURI(string(decoded), "")
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
	basePath    string
}

// NewAoneOAuthHandler creates a new Aone OAuth handler.
func NewAoneOAuthHandler(configStore configstore.ConfigStore, stateStore *AoneOAuthStateStore, vkReloader VirtualKeyReloader, basePath string) *AoneOAuthHandler {
	return &AoneOAuthHandler{
		configStore: configStore,
		stateStore:  stateStore,
		vkReloader:  vkReloader,
		basePath:    lib.NormalizeBasePath(basePath),
	}
}

// RegisterRoutes registers Aone OAuth routes.
func (h *AoneOAuthHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	r.GET("/api/aone/oauth/config", lib.ChainMiddlewares(h.getConfig, middlewares...))
	r.GET("/api/aone/oauth/authorize", lib.ChainMiddlewares(h.authorize, middlewares...))
	r.GET("/api/aone/oauth/callback", lib.ChainMiddlewares(h.callback, middlewares...))
	r.GET("/api/aone/oauth/zd-switch/callback", lib.ChainMiddlewares(h.callback, middlewares...))
	r.GET("/api/aone/oauth/zd-switch/handoff", lib.ChainMiddlewares(h.zdSwitchHandoff, middlewares...))
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

	basePath := h.effectiveBasePath(ctx, cfg.RedirectURI.GetValue())
	loginSource := resolveLoginSource(ctx, basePath)
	externalRedirectURI := ""
	if loginSource != loginSourceZdSwitch {
		externalRedirectURI = resolvePostLoginRedirectURI(ctx, basePath)
	}

	var returnTo string
	var oauthRedirectURI string
	if loginSource == loginSourceZdSwitch {
		oauthRedirectURI = buildZdSwitchOAuthCallbackURI(ctx, cfg.RedirectURI.GetValue(), basePath)
		returnTo = buildZdSwitchSuccessReturnTo(ctx, "", cfg.RedirectURI.GetValue(), basePath)
	} else {
		configuredCallbackURI := resolveAoneOAuthCallbackBaseURI(ctx, cfg.RedirectURI.GetValue(), basePath)
		returnTo = parseAoneOAuthReturnTo(string(ctx.QueryArgs().Peek("return_to")), configuredCallbackURI, basePath)
		if externalRedirectURI != "" {
			returnTo = resolveAuthorizeReturnTo(ctx, returnTo, externalRedirectURI, basePath)
		}
		oauthRedirectURI = buildOAuthCallbackRedirectURI(configuredCallbackURI)
	}
	returnTo = ensureSubpathRedirect(basePath, returnTo)

	state, err := h.stateStore.Issue(returnTo, externalRedirectURI, oauthRedirectURI, loginSource, dashboardOriginFromRequest(ctx))
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to initiate OAuth flow")
		return
	}

	client := aoneoauth.NewClient(cfg.BaseURL.GetValue())
	authorizeURL := client.AuthorizeURL(
		cfg.ClientID.GetValue(),
		oauthRedirectURI,
		state,
	)
	ctx.Redirect(authorizeURL, fasthttp.StatusFound)
}

func (h *AoneOAuthHandler) callback(ctx *fasthttp.RequestCtx) {
	state := string(ctx.QueryArgs().Peek("state"))
	returnTo, externalRedirectURI, oauthRedirectURI, loginSource, dashboardOrigin, stateValid := h.stateStore.Consume(state)
	basePath := h.effectiveBasePath(ctx, oauthRedirectURI)
	callbackPostLoginRedirect := extractPostLoginRedirectFromCallback(ctx, basePath)
	returnTo = ensureSubpathRedirect(basePath, returnTo)
	if !stateValid {
		h.redirectTo(ctx, aoneOAuthLoginRedirect("", callbackPostLoginRedirect, "", "Invalid or expired OAuth state", basePath))
		return
	}
	if loginSource == loginSourceZdSwitch {
		returnTo = buildZdSwitchSuccessReturnTo(ctx, "", "", basePath)
	} else {
		returnTo = resolveAoneOAuthSuccessReturnTo(ctx, returnTo, externalRedirectURI, basePath)
	}

	errorParam := string(ctx.QueryArgs().Peek("error"))
	if errorParam != "" {
		errorDescription := string(ctx.QueryArgs().Peek("error_description"))
		logger.Warn("[aone-oauth] upstream callback error: error=%s description=%s", errorParam, errorDescription)
		h.redirectTo(ctx, aoneOAuthLoginRedirect(returnTo, externalRedirectURI, loginSource, "Aone authentication was denied or failed", basePath))
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
		h.redirectTo(ctx, aoneOAuthLoginRedirect(returnTo, externalRedirectURI, loginSource, "Aone OAuth is not configured", basePath))
		return
	}
	if cfg == nil {
		h.redirectTo(ctx, aoneOAuthLoginRedirect(returnTo, externalRedirectURI, loginSource, "Aone OAuth is not configured", basePath))
		return
	}
	if basePath == "" {
		basePath = h.effectiveBasePath(ctx, cfg.RedirectURI.GetValue())
	}

	client := aoneoauth.NewClient(cfg.BaseURL.GetValue())
	if oauthRedirectURI == "" {
		if loginSource == loginSourceZdSwitch {
			oauthRedirectURI = buildZdSwitchOAuthCallbackURI(ctx, cfg.RedirectURI.GetValue(), basePath)
		} else {
			oauthRedirectURI = buildOAuthCallbackRedirectURI(
				resolveAoneOAuthCallbackBaseURI(ctx, cfg.RedirectURI.GetValue(), basePath),
			)
		}
	}
	tokenResp, err := client.ExchangeAuthorizationCode(
		ctx,
		code,
		cfg.ClientID.GetValue(),
		cfg.ClientSecret.GetValue(),
		oauthRedirectURI,
	)
	if err != nil {
		logger.Error("[aone-oauth] token exchange failed: %v", err)
		h.redirectTo(ctx, aoneOAuthLoginRedirect(returnTo, externalRedirectURI, loginSource, "Failed to exchange authorization code", basePath))
		return
	}

	if loginSource == loginSourceZdSwitch {
		sessionToken, bootstrapErr := h.bootstrapSourceScopedLogin(ctx, client, loginSource, tokenResp)
		if bootstrapErr != nil {
			if errors.Is(bootstrapErr, configstore.ErrAoneUserDisabled) {
				h.redirectTo(ctx, aoneOAuthLoginRedirect(returnTo, externalRedirectURI, loginSource, "Your account has been disabled", basePath))
				return
			}
			logger.Error("[aone-oauth] failed to bootstrap zd-switch login: %v", bootstrapErr)
			h.redirectTo(ctx, aoneOAuthLoginRedirect(returnTo, externalRedirectURI, loginSource, "Failed to complete ZD Switch login", basePath))
			return
		}
		h.redirectTo(ctx, buildZdSwitchSuccessReturnTo(ctx, sessionToken, cfg.RedirectURI.GetValue(), basePath))
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
				h.redirectTo(ctx, aoneOAuthLoginRedirect(returnTo, externalRedirectURI, loginSource, "Your account has been disabled", basePath))
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

	sessionToken, err := h.createDashboardSessionToken(ctx, aoneUserID, loginSourceDashboard, aoneSessionExpiresAt(tokenResp))
	if err != nil {
		logger.Error("[aone-oauth] failed to create dashboard session: %v", err)
		h.redirectTo(ctx, aoneOAuthLoginRedirect(returnTo, externalRedirectURI, loginSource, "Failed to create session", basePath))
		return
	}
	if aoneUserID != "" {
		if err := h.persistSourceScopedOAuthTokens(ctx, aoneUserID, loginSourceDashboard, sessionToken, tokenResp); err != nil {
			logger.Warn("[aone-oauth] failed to persist oauth tokens for dashboard user=%s: %v", aoneUserID, err)
		}
	}

	h.redirectTo(ctx, resolveDashboardReturnTo(returnTo, dashboardOrigin, basePath))
}

func (h *AoneOAuthHandler) zdSwitchHandoff(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		h.redirectTo(ctx, aoneOAuthLoginRedirect("", "", loginSourceZdSwitch, "Config store is not available", h.basePath))
		return
	}

	cfg, err := h.loadConfiguredAoneOAuth(ctx)
	if err != nil {
		h.redirectTo(ctx, aoneOAuthLoginRedirect("", "", loginSourceZdSwitch, "Failed to load Aone OAuth config", h.basePath))
		return
	}
	if cfg == nil {
		h.redirectTo(ctx, aoneOAuthLoginRedirect("", "", loginSourceZdSwitch, "Aone OAuth is not configured", h.basePath))
		return
	}

	basePath := h.effectiveBasePath(ctx, cfg.RedirectURI.GetValue())
	token := dashboardSessionTokenFromRequest(ctx)
	if token == "" {
		h.redirectTo(ctx, ensureSubpathRedirect(basePath, "/login?source="+loginSourceZdSwitch))
		return
	}

	session, err := h.configStore.GetSession(ctx, token)
	if err != nil || session == nil || !session.ExpiresAt.After(time.Now()) {
		h.redirectTo(ctx, ensureSubpathRedirect(basePath, "/login?source="+loginSourceZdSwitch))
		return
	}
	if session.AoneUserID == nil || strings.TrimSpace(*session.AoneUserID) == "" {
		h.redirectTo(ctx, aoneOAuthLoginRedirect("", "", loginSourceZdSwitch, "ZD Switch requires an Aone user session", h.basePath))
		return
	}

	h.redirectTo(ctx, buildZdSwitchSuccessReturnTo(ctx, token, cfg.RedirectURI.GetValue(), basePath))
}

func dashboardSessionTokenFromRequest(ctx *fasthttp.RequestCtx) string {
	if authHeader := string(ctx.Request.Header.Peek("Authorization")); strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	}
	return strings.TrimSpace(string(ctx.Request.Header.Cookie("token")))
}

func (h *AoneOAuthHandler) bootstrapSourceScopedLogin(
	ctx *fasthttp.RequestCtx,
	client *aoneoauth.Client,
	loginSource string,
	tokenResp *aoneoauth.TokenResponse,
) (string, error) {
	if h.configStore == nil {
		return "", fmt.Errorf("config store is not available")
	}
	if tokenResp == nil || strings.TrimSpace(tokenResp.AccessToken) == "" {
		return "", fmt.Errorf("missing oauth access token")
	}

	meResp, err := client.GetMe(ctx, tokenResp.AccessToken)
	if err != nil {
		return "", fmt.Errorf("fetch aone user profile: %w", err)
	}
	if meResp == nil {
		return "", fmt.Errorf("empty aone user profile")
	}

	user, err := h.configStore.UpsertAoneUserFromLogin(ctx, meResp)
	if err != nil {
		return "", err
	}
	if user == nil {
		return "", fmt.Errorf("failed to upsert aone user")
	}

	if vk, vkErr := h.configStore.EnsureAoneUserVirtualKey(ctx, user.AoneUserID); vkErr != nil {
		return "", fmt.Errorf("ensure user virtual key: %w", vkErr)
	} else if vk != nil && h.vkReloader != nil {
		if _, reloadErr := h.vkReloader.ReloadVirtualKey(ctx, vk.ID); reloadErr != nil {
			logger.Warn("[aone-oauth] failed to reload user virtual key for source=%s: %v", loginSource, reloadErr)
		} else {
			MarkAoneVirtualKeyReloaded(vk.ID)
		}
	}

	sessionToken, err := h.createDashboardSessionToken(ctx, user.AoneUserID, loginSource, aoneSessionExpiresAt(tokenResp))
	if err != nil {
		return "", err
	}
	if err := h.persistSourceScopedOAuthTokens(ctx, user.AoneUserID, loginSource, sessionToken, tokenResp); err != nil {
		logger.Warn("[aone-oauth] failed to persist oauth tokens for source=%s user=%s: %v", loginSource, user.AoneUserID, err)
	}
	return sessionToken, nil
}

func (h *AoneOAuthHandler) persistSourceScopedOAuthTokens(
	ctx *fasthttp.RequestCtx,
	aoneUserID, loginSource, sessionToken string,
	tokenResp *aoneoauth.TokenResponse,
) error {
	loginSource = validateLoginSource(loginSource)
	if loginSource == "" || h.configStore == nil {
		return nil
	}
	_, err := h.configStore.UpsertAoneUserOAuthToken(ctx, aoneUserID, loginSource, sessionToken, tokenResp)
	return err
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

func (h *AoneOAuthHandler) createDashboardSessionToken(ctx *fasthttp.RequestCtx, aoneUserID, loginSource string, expiresAt time.Time) (string, error) {
	now := time.Now()
	token := uuid.New().String()
	session := &tables.SessionsTable{
		Token:       token,
		ExpiresAt:   expiresAt,
		LoginSource: loginSource,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if aoneUserID != "" {
		session.AoneUserID = &aoneUserID
	}
	if err := h.configStore.CreateSession(ctx, session); err != nil {
		return "", err
	}
	setSessionCookie(ctx, token, session.ExpiresAt)
	return token, nil
}

// aoneSessionExpiresAt derives a dashboard session expiry from an Aone OAuth
// token response. The session lifetime tracks the access token's lifetime so
// the session and token lapse together; the refresh path then extends both.
func aoneSessionExpiresAt(tokenResp *aoneoauth.TokenResponse) time.Time {
	if tokenResp != nil && tokenResp.ExpiresIn > 0 {
		return time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	}
	return time.Now().Add(defaultAoneSessionTTL)
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

func validateLoginRedirectURI(raw, basePath string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" ||
		strings.HasPrefix(raw, "//") ||
		strings.Contains(raw, "\\") ||
		strings.Contains(raw, "\n") ||
		strings.Contains(raw, "\r") {
		return ""
	}
	canonical := stripAppRoutePrefix(basePath, raw)
	if isWorkspaceReturnPath(canonical) {
		return canonical
	}
	if strings.HasPrefix(raw, "/") && !strings.HasPrefix(raw, "//") {
		if strings.HasPrefix(canonical, "/login") || strings.HasPrefix(canonical, "/workspace/") {
			return canonical
		}
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return ""
	}
	if strings.HasSuffix(parsed.Path, "/api/aone/oauth/callback") ||
		strings.HasSuffix(parsed.Path, zdSwitchOAuthCallbackPath) ||
		strings.HasSuffix(lib.StripBasePath(basePath, parsed.Path), "/api/aone/oauth/callback") ||
		strings.HasSuffix(lib.StripBasePath(basePath, parsed.Path), zdSwitchOAuthCallbackPath) {
		return ""
	}
	return parsed.String()
}

func validateLoginSource(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == loginSourceZdSwitch {
		return loginSourceZdSwitch
	}
	return ""
}

func resolveLoginSource(ctx *fasthttp.RequestCtx, basePath string) string {
	if rawQuery := string(ctx.URI().QueryString()); rawQuery != "" {
		if values, err := url.ParseQuery(rawQuery); err == nil {
			if validated := validateLoginSource(values.Get("source")); validated != "" {
				return validated
			}
		}
	}
	return extractLoginSourceFromLoginReferer(ctx, basePath)
}

func extractLoginSourceFromLoginReferer(ctx *fasthttp.RequestCtx, basePath string) string {
	referer := strings.TrimSpace(string(ctx.Request.Header.Peek("Referer")))
	if referer == "" {
		return ""
	}
	parsed, err := url.Parse(referer)
	if err != nil || lib.StripBasePath(basePath, parsed.Path) != "/login" {
		return ""
	}
	return validateLoginSource(parsed.Query().Get("source"))
}

func buildZdSwitchOAuthCallbackURI(ctx *fasthttp.RequestCtx, configuredRedirectURI, basePath string) string {
	if origin := bifrostAPIOrigin(ctx, configuredRedirectURI); origin != "" {
		if u, err := url.Parse(origin); err == nil {
			u.Path = lib.WithBasePath(basePath, zdSwitchOAuthCallbackPath)
			u.RawQuery = ""
			u.Fragment = ""
			return u.String()
		}
	}
	return ""
}

func buildZdSwitchDeeplink(accessToken, baseURL string) string {
	q := url.Values{}
	q.Set("access_token", accessToken)
	if normalized := normalizeZdSwitchBaseURL(baseURL); normalized != "" {
		q.Set(zdSwitchBaseURLQueryKey, normalized)
	}
	return loginSourceZdSwitch + "://" + zdSwitchDeeplinkHost + "?" + q.Encode()
}

func normalizeZdSwitchBaseURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return ""
	}
	parsed.Path = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/")
}

func buildZdSwitchSuccessReturnTo(ctx *fasthttp.RequestCtx, accessToken, configuredRedirectURI, basePath string) string {
	apiOrigin := normalizeZdSwitchBaseURL(bifrostAPIOrigin(ctx, configuredRedirectURI))
	q := url.Values{}
	if accessToken != "" {
		q.Set("access_token", accessToken)
	}
	if apiOrigin != "" {
		q.Set(zdSwitchBaseURLQueryKey, apiOrigin)
	}
	if apiOrigin != "" {
		u, err := url.Parse(apiOrigin)
		if err != nil {
			return lib.WithBasePath(basePath, loginZdSwitchSuccessPath)
		}
		u.Path = lib.WithBasePath(basePath, loginZdSwitchSuccessPath)
		u.RawQuery = q.Encode()
		u.Fragment = ""
		return u.String()
	}
	if len(q) == 0 {
		return lib.WithBasePath(basePath, loginZdSwitchSuccessPath)
	}
	return lib.WithBasePath(basePath, loginZdSwitchSuccessPath+"?"+q.Encode())
}

func bifrostAPIOrigin(ctx *fasthttp.RequestCtx, configuredRedirectURI string) string {
	if origin := requestHostOrigin(ctx); origin != "" {
		return origin
	}
	configuredRedirectURI = strings.TrimSpace(configuredRedirectURI)
	if configuredRedirectURI == "" {
		return ""
	}
	u, err := url.Parse(configuredRedirectURI)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	normalizeLocalhostDevPort(u)
	u.Path = ""
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

func resolveAoneOAuthCallbackBaseURI(ctx *fasthttp.RequestCtx, configuredRedirectURI, basePath string) string {
	configuredRedirectURI = strings.TrimSpace(configuredRedirectURI)
	if configuredRedirectURI == "" {
		if origin := bifrostAPIOrigin(ctx, ""); origin != "" {
			if u, err := url.Parse(origin); err == nil {
				u.Path = lib.WithBasePath(basePath, "/api/aone/oauth/callback")
				u.RawQuery = ""
				u.Fragment = ""
				return u.String()
			}
		}
		return ""
	}
	parsed, err := url.Parse(configuredRedirectURI)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return configuredRedirectURI
	}
	normalizeLocalhostDevPort(parsed)
	if apiOrigin := bifrostAPIOrigin(ctx, configuredRedirectURI); apiOrigin != "" {
		if apiParsed, err := url.Parse(apiOrigin); err == nil && isLocalhostHost(parsed.Host) && isLocalhostHost(apiParsed.Host) {
			parsed.Scheme = apiParsed.Scheme
			parsed.Host = apiParsed.Host
		}
	}
	if parsed.Path == "" || parsed.Path == "/" {
		parsed.Path = lib.WithBasePath(basePath, "/api/aone/oauth/callback")
	} else {
		applySubpathToURLPath(parsed, basePath)
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func normalizeLocalhostDevPort(u *url.URL) {
	if u == nil {
		return
	}
	host := strings.ToLower(u.Host)
	switch host {
	case "localhost:3000", "127.0.0.1:3000":
		u.Host = strings.Replace(host, ":3000", ":8080", 1)
	}
}

func isLocalhostHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	return strings.HasPrefix(host, "localhost:") ||
		strings.HasPrefix(host, "127.0.0.1:") ||
		host == "localhost" ||
		host == "127.0.0.1"
}

func requestHostOrigin(ctx *fasthttp.RequestCtx) string {
	scheme := "http"
	if string(ctx.Request.Header.Peek("X-Forwarded-Proto")) == "https" {
		scheme = "https"
	}
	host := string(ctx.Host())
	if host == "" {
		return ""
	}
	return scheme + "://" + host
}

// buildOAuthCallbackRedirectURI returns the redirect_uri registered with Aone and used
// in token exchange. It must not include post-login query parameters; those are stored
// in the OAuth state store instead.
func buildOAuthCallbackRedirectURI(baseRedirectURI string) string {
	baseRedirectURI = strings.TrimSpace(baseRedirectURI)
	if baseRedirectURI == "" {
		return ""
	}
	baseParsed, err := url.Parse(baseRedirectURI)
	if err != nil {
		return baseRedirectURI
	}
	baseParsed.Fragment = ""
	baseParsed.RawQuery = ""
	baseParsed.ForceQuery = false
	return baseParsed.String()
}

func extractPostLoginRedirectFromCallback(ctx *fasthttp.RequestCtx, basePath string) string {
	if rawQuery := string(ctx.URI().QueryString()); rawQuery != "" {
		if values, err := url.ParseQuery(rawQuery); err == nil {
			if validated := validateLoginRedirectURI(values.Get(postLoginRedirectQueryKey), basePath); validated != "" {
				return validated
			}
		}
	}
	return ""
}

func resolvePostLoginRedirectURI(ctx *fasthttp.RequestCtx, basePath string) string {
	if rawQuery := string(ctx.URI().QueryString()); rawQuery != "" {
		if values, err := url.ParseQuery(rawQuery); err == nil {
			for _, key := range []string{"post_login_redirect", "redirect_uri"} {
				if validated := validateLoginRedirectURI(values.Get(key), basePath); validated != "" {
					return validated
				}
			}
		}
	}
	if extracted := extractRedirectURIFromLoginCompleteReturnTo(string(ctx.QueryArgs().Peek("return_to")), basePath); extracted != "" {
		return extracted
	}
	return extractRedirectURIFromLoginReferer(ctx, basePath)
}

func isWorkspaceReturnPath(path string) bool {
	return path == defaultAoneOAuthReturnTo ||
		strings.HasPrefix(path, defaultAoneOAuthReturnTo+"/") ||
		strings.HasPrefix(path, defaultAoneOAuthReturnTo+"?") ||
		strings.HasPrefix(path, defaultAoneOAuthReturnTo+"#")
}

func dashboardOrigin(ctx *fasthttp.RequestCtx) string {
	if referer := strings.TrimSpace(string(ctx.Request.Header.Peek("Referer"))); referer != "" {
		if u, err := url.Parse(referer); err == nil && u.Scheme != "" && u.Host != "" {
			u.Path = ""
			u.RawQuery = ""
			u.Fragment = ""
			return u.String()
		}
	}
	return requestHostOrigin(ctx)
}

func dashboardOriginFromRequest(ctx *fasthttp.RequestCtx) string {
	return dashboardOrigin(ctx)
}

func resolveDashboardReturnTo(returnTo, dashboardOrigin, basePath string) string {
	returnTo = strings.TrimSpace(returnTo)
	if returnTo == "" {
		returnTo = defaultAppReturnTo(basePath)
	}
	if strings.HasPrefix(returnTo, "http://") || strings.HasPrefix(returnTo, "https://") {
		return ensureSubpathRedirect(basePath, returnTo)
	}
	dashboardOrigin = strings.TrimSpace(dashboardOrigin)
	if dashboardOrigin == "" {
		return ensureSubpathRedirect(basePath, returnTo)
	}
	base, err := url.Parse(dashboardOrigin)
	if err != nil || base.Scheme == "" || base.Host == "" {
		return ensureSubpathRedirect(basePath, returnTo)
	}
	if !strings.HasPrefix(returnTo, "/") {
		return ensureSubpathRedirect(basePath, returnTo)
	}
	pathURL, err := url.Parse(returnTo)
	if err != nil {
		return ensureSubpathRedirect(basePath, returnTo)
	}
	base.Path = lib.WithBasePath(basePath, lib.StripBasePath(basePath, pathURL.Path))
	base.RawQuery = pathURL.RawQuery
	base.Fragment = ""
	return base.String()
}

func extractRedirectURIFromLoginReferer(ctx *fasthttp.RequestCtx, basePath string) string {
	referer := strings.TrimSpace(string(ctx.Request.Header.Peek("Referer")))
	if referer == "" {
		return ""
	}
	parsed, err := url.Parse(referer)
	if err != nil || lib.StripBasePath(basePath, parsed.Path) != "/login" {
		return ""
	}
	return validateLoginRedirectURI(parsed.Query().Get("redirect_uri"), basePath)
}

func loginCompleteReturnToForRedirectURI(redirectURI, basePath string) string {
	redirectURI = validateLoginRedirectURI(redirectURI, basePath)
	if redirectURI == "" {
		return defaultAppReturnTo(basePath)
	}
	q := url.Values{}
	q.Set("redirect_uri", redirectURI)
	return lib.WithBasePath(basePath, "/login/complete?"+q.Encode())
}

func buildLoginCompleteReturnTo(ctx *fasthttp.RequestCtx, redirectURI, basePath string) string {
	redirectURI = validateLoginRedirectURI(redirectURI, basePath)
	if redirectURI == "" {
		return defaultAppReturnTo(basePath)
	}
	origin := dashboardOrigin(ctx)
	if origin == "" {
		return defaultAppReturnTo(basePath)
	}
	u, err := url.Parse(origin)
	if err != nil {
		return defaultAppReturnTo(basePath)
	}
	u.Path = lib.WithBasePath(basePath, "/login/complete")
	q := u.Query()
	q.Set("redirect_uri", redirectURI)
	u.RawQuery = q.Encode()
	return u.String()
}

func extractRedirectURIFromLoginCompleteReturnTo(returnTo, basePath string) string {
	parsed, err := url.Parse(returnTo)
	if err != nil || lib.StripBasePath(basePath, parsed.Path) != "/login/complete" {
		return ""
	}
	return validateLoginRedirectURI(parsed.Query().Get("redirect_uri"), basePath)
}

func loginCompleteReturnToMatchesRedirectURI(returnTo, redirectURI, basePath string) bool {
	parsed, err := url.Parse(returnTo)
	if err != nil || lib.StripBasePath(basePath, parsed.Path) != "/login/complete" {
		return false
	}
	stored := validateLoginRedirectURI(parsed.Query().Get("redirect_uri"), basePath)
	return stored != "" && stored == redirectURI
}

func resolveAuthorizeReturnTo(ctx *fasthttp.RequestCtx, returnTo, redirectURI, basePath string) string {
	if loginCompleteReturnToMatchesRedirectURI(returnTo, redirectURI, basePath) {
		return returnTo
	}
	return buildLoginCompleteReturnTo(ctx, redirectURI, basePath)
}

func resolveAoneOAuthSuccessReturnTo(ctx *fasthttp.RequestCtx, returnTo, redirectURI, basePath string) string {
	if redirectURI != "" {
		return resolveAuthorizeReturnTo(ctx, returnTo, redirectURI, basePath)
	}
	if validated := validateLoginRedirectURI(returnTo, basePath); validated != "" && isWorkspaceReturnPath(validated) {
		return ensureSubpathRedirect(basePath, validated)
	}
	if parsed, ok := validateAoneOAuthReturnPath(returnTo, basePath); ok {
		return ensureSubpathRedirect(basePath, parsed)
	}
	return defaultAppReturnTo(basePath)
}

func parseAoneOAuthReturnTo(raw, redirectURI, basePath string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return defaultAppReturnTo(basePath)
	}
	if strings.HasPrefix(raw, "/") {
		canonical := stripAppRoutePrefix(basePath, raw)
		if isAllowedAoneOAuthReturnPath(canonical) {
			return ensureSubpathRedirect(basePath, canonical)
		}
		return defaultAppReturnTo(basePath)
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return defaultAppReturnTo(basePath)
	}
	if !isAllowedAoneOAuthReturnPath(lib.StripBasePath(basePath, parsed.Path)) {
		return defaultAppReturnTo(basePath)
	}
	if strings.EqualFold(parsed.Hostname(), "localhost") {
		applySubpathToURLPath(parsed, basePath)
		return parsed.String()
	}
	redirect, err := url.Parse(redirectURI)
	if err != nil || redirect.Host == "" {
		return defaultAppReturnTo(basePath)
	}
	if strings.EqualFold(parsed.Hostname(), redirect.Hostname()) {
		applySubpathToURLPath(parsed, basePath)
		return parsed.String()
	}
	return defaultAppReturnTo(basePath)
}

func validateAoneOAuthReturnPath(raw, basePath string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return defaultAoneOAuthReturnTo, true
	}
	if strings.HasPrefix(raw, "/") {
		canonical := stripAppRoutePrefix(basePath, raw)
		if isAllowedAoneOAuthReturnPath(canonical) {
			return canonical, true
		}
		return "", false
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", false
	}
	if !isAllowedAoneOAuthReturnPath(lib.StripBasePath(basePath, parsed.Path)) {
		return "", false
	}
	return parsed.String(), true
}

func isAllowedAoneOAuthReturnPath(path string) bool {
	if path == "/login/complete" ||
		strings.HasPrefix(path, "/login/complete?") ||
		strings.HasPrefix(path, "/login/complete#") {
		return true
	}
	if path == loginZdSwitchSuccessPath ||
		strings.HasPrefix(path, loginZdSwitchSuccessPath+"?") ||
		strings.HasPrefix(path, loginZdSwitchSuccessPath+"#") {
		return true
	}
	return path == defaultAoneOAuthReturnTo ||
		strings.HasPrefix(path, defaultAoneOAuthReturnTo+"/") ||
		strings.HasPrefix(path, defaultAoneOAuthReturnTo+"?") ||
		strings.HasPrefix(path, defaultAoneOAuthReturnTo+"#")
}

func aoneOAuthLoginRedirect(returnTo, redirectURI, loginSource, message, basePath string) string {
	q := url.Values{}
	q.Set("error", message)
	if loginSource == loginSourceZdSwitch {
		q.Set("source", loginSourceZdSwitch)
		return ensureSubpathRedirect(basePath, "/login?"+q.Encode())
	}
	if validated := validateLoginRedirectURI(redirectURI, basePath); validated != "" {
		q.Set("redirect_uri", validated)
		return ensureSubpathRedirect(basePath, "/login?"+q.Encode())
	}
	if parsed, ok := validateAoneOAuthReturnPath(returnTo, basePath); ok {
		if u, err := url.Parse(parsed); err == nil && u.Scheme != "" && u.Host != "" {
			u.Path = lib.WithBasePath(basePath, "/login")
			u.RawQuery = q.Encode()
			u.Fragment = ""
			return u.String()
		}
	}
	return ensureSubpathRedirect(basePath, "/login?"+q.Encode())
}
