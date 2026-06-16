package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/fasthttp/router"
	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

// SessionHandler manages HTTP requests for session operations
type SessionHandler struct {
	configStore            configstore.ConfigStore
	wsTicketStore          *WSTicketStore
	adminEstablishStore    *AdminEstablishTicketStore
}

// NewSessionHandler creates a new session handler instance
func NewSessionHandler(configStore configstore.ConfigStore, wsTicketStore *WSTicketStore, adminEstablishStore *AdminEstablishTicketStore) *SessionHandler {
	if adminEstablishStore == nil {
		adminEstablishStore = NewAdminEstablishTicketStore()
	}
	return &SessionHandler{
		configStore:         configStore,
		wsTicketStore:       wsTicketStore,
		adminEstablishStore: adminEstablishStore,
	}
}

const defaultAdminPostLoginPath = "/workspace/dashboard"

// RegisterRoutes registers the session-related routes
func (h *SessionHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	r.POST("/api/session/login", lib.ChainMiddlewares(h.login, middlewares...))
	r.POST("/api/session/admin-login", lib.ChainMiddlewares(h.adminLoginForm, middlewares...))
	r.GET("/api/session/admin-login/establish", lib.ChainMiddlewares(h.adminLoginEstablish, middlewares...))
	r.POST("/api/session/logout", lib.ChainMiddlewares(h.logout, middlewares...))
	r.GET("/api/session/is-auth-enabled", lib.ChainMiddlewares(h.isAuthEnabled, middlewares...))
	r.POST("/api/session/ws-ticket", lib.ChainMiddlewares(h.issueWSTicket, middlewares...))
}

// isAuthEnabled handles GET /api/session/is-auth-enabled - Check if auth is enabled
func (h *SessionHandler) isAuthEnabled(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendJSON(ctx, map[string]any{
			"is_auth_enabled": false,
			"has_valid_token": false,
			"auth_type":       "none",
		})
		return
	}
	authConfig, err := h.configStore.GetAuthConfig(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get auth config: %v", err))
		return
	}
	if authConfig == nil {
		SendJSON(ctx, map[string]any{
			"is_auth_enabled": false,
			"has_valid_token": false,
			"auth_type":       "none",
		})
		return
	}
	// Check if the header has a token and is valid (Authorization header or cookie)
	token := ""
	if authHeader := string(ctx.Request.Header.Peek("Authorization")); strings.HasPrefix(authHeader, "Bearer ") {
		token = strings.TrimPrefix(authHeader, "Bearer ")
	}
	userToken := userSessionTokenFromCookie(ctx)
	adminToken := adminSessionTokenFromCookie(ctx)
	if token == "" {
		token = userToken
	}
	hasValidToken := false
	isAoneUserSession := false
	isLocalAdminSession := false
	if token != "" {
		session, err := h.configStore.GetSession(ctx, token)
		if err == nil && session != nil {
			// A lapsed Aone session is still considered valid here if it can be
			// refreshed server-side against the Aone refresh endpoint; this keeps
			// the dashboard from bouncing the user to /login on a recoverable
			// session and re-sets the (extended) cookie.
			if session.ExpiresAt.After(time.Now()) || refreshDashboardSession(ctx, h.configStore, session, token) {
				hasValidToken = true
				if session.AoneUserID != nil && *session.AoneUserID != "" {
					isAoneUserSession = true
				} else {
					isLocalAdminSession = true
				}
			}
		}
	}
	// Admin sessions use a separate cookie and can coexist with an Aone user
	// session in the same browser; always evaluate it independently.
	if adminToken != "" && validateLocalAdminSession(h.configStore, adminToken) {
		isLocalAdminSession = true
		if !hasValidToken {
			hasValidToken = true
		}
	}
	if authConfig == nil || !authConfig.IsEnabled {
		isLocalAdminSession = true
	}
	SendJSON(ctx, map[string]any{
		"is_auth_enabled":        authConfig.IsEnabled,
		"has_valid_token":        hasValidToken,
		"auth_type":              dashboardAuthTypeFromConfig(authConfig),
		"aone_oauth_enabled":     aoneOAuthEnabled(authConfig),
		"is_aone_user_session":   isAoneUserSession,
		"is_local_admin_session": isLocalAdminSession,
	})
}

// login handles POST /api/session/login - Login a user
func (h *SessionHandler) login(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusForbidden, "Authentication is not enabled")
		return
	}
	payload := struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}{}
	if err := json.Unmarshal(ctx.PostBody(), &payload); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("Invalid request format: %v", err))
		return
	}

	token, expiresAt, statusCode, message := h.createLocalAdminSession(ctx, payload.Username, payload.Password)
	if statusCode != 0 {
		SendError(ctx, statusCode, message)
		return
	}

	establishPath, err := h.issueAdminEstablishPath(token, expiresAt)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to prepare admin session: %v", err))
		return
	}

	// Keep setting the cookie for callers that rely on fetch() (for example /login).
	setAdminSessionCookie(ctx, token, expiresAt)

	SendJSON(ctx, map[string]any{
		"message":         "Login successful",
		"establish_path": establishPath,
	})
}

// adminLoginForm handles POST /api/session/admin-login - browser form login for /admin-login.
// A top-level navigation response is more reliable than fetch() for establishing HttpOnly cookies.
func (h *SessionHandler) adminLoginForm(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		h.redirectAdminLoginError(ctx, "Authentication is not enabled")
		return
	}

	username := strings.TrimSpace(string(ctx.FormValue("username")))
	password := string(ctx.FormValue("password"))
	_ = validateLoginRedirectURI(string(ctx.FormValue("return_to")), configuredSessionCookieBasePath)

	token, expiresAt, statusCode, message := h.createLocalAdminSession(ctx, username, password)
	if statusCode != 0 {
		h.redirectAdminLoginError(ctx, message)
		return
	}

	establishPath, err := h.issueAdminEstablishPath(token, expiresAt)
	if err != nil {
		h.redirectAdminLoginError(ctx, "Failed to prepare admin session")
		return
	}

	ctx.Redirect(establishPath, fasthttp.StatusSeeOther)
}

// adminLoginEstablish handles GET /api/session/admin-login/establish - sets admin_token via navigation.
func (h *SessionHandler) adminLoginEstablish(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil || h.adminEstablishStore == nil {
		h.redirectAdminLoginError(ctx, "Authentication is not enabled")
		return
	}

	ticket := strings.TrimSpace(string(ctx.QueryArgs().Peek("ticket")))
	token, expiresAt, ok := h.adminEstablishStore.Consume(ticket)
	if !ok || !validateLocalAdminSession(h.configStore, token) {
		h.redirectAdminLoginError(ctx, "Admin session could not be established")
		return
	}

	setAdminSessionCookie(ctx, token, expiresAt)
	ctx.Redirect(ensureSubpathRedirect(configuredSessionCookieBasePath, defaultAdminPostLoginPath), fasthttp.StatusSeeOther)
}

func (h *SessionHandler) issueAdminEstablishPath(token string, expiresAt time.Time) (string, error) {
	ticket, err := h.adminEstablishStore.Issue(token, expiresAt)
	if err != nil {
		return "", err
	}
	path := "/api/session/admin-login/establish?ticket=" + url.QueryEscape(ticket)
	return ensureSubpathRedirect(configuredSessionCookieBasePath, path), nil
}

func (h *SessionHandler) createLocalAdminSession(ctx *fasthttp.RequestCtx, username, password string) (token string, expiresAt time.Time, statusCode int, message string) {
	authConfig, err := h.configStore.GetAuthConfig(ctx)
	if err != nil {
		return "", time.Time{}, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get auth config: %v", err)
	}
	if authConfig == nil || !authConfig.IsEnabled {
		return "", time.Time{}, fasthttp.StatusForbidden, "Authentication is not enabled"
	}
	if username != authConfig.AdminUserName.GetValue() {
		return "", time.Time{}, fasthttp.StatusUnauthorized, "Invalid username or password"
	}
	compare, err := encrypt.CompareHash(authConfig.AdminPassword.GetValue(), password)
	if err != nil {
		return "", time.Time{}, fasthttp.StatusUnauthorized, "Unauthorized"
	}
	if !compare {
		return "", time.Time{}, fasthttp.StatusUnauthorized, "Invalid username or password"
	}

	// Each login gets its own token so multiple browsers/devices stay signed in.
	now := time.Now()
	expiresAt = now.Add(adminSessionTTL)
	token = uuid.New().String()
	session := &tables.SessionsTable{
		Token:     token,
		ExpiresAt: expiresAt,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := h.configStore.CreateSession(ctx, session); err != nil {
		return "", time.Time{}, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to create session: %v", err)
	}
	return token, expiresAt, 0, ""
}

func (h *SessionHandler) redirectAdminLoginError(ctx *fasthttp.RequestCtx, message string) {
	target := ensureSubpathRedirect(configuredSessionCookieBasePath, "/admin-login")
	if strings.TrimSpace(message) != "" {
		target += "?error=" + url.QueryEscape(message)
	}
	ctx.Redirect(target, fasthttp.StatusSeeOther)
}

// logout handles POST /api/session/logout - Logout a user
func (h *SessionHandler) logout(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusForbidden, "Authentication is not enabled")
		return
	}
	payload := struct {
		Scope string `json:"scope"`
	}{}
	if len(ctx.PostBody()) > 0 {
		if err := json.Unmarshal(ctx.PostBody(), &payload); err != nil {
			SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("Invalid request format: %v", err))
			return
		}
	}
	scope := strings.TrimSpace(strings.ToLower(payload.Scope))
	if scope == "" {
		scope = "user"
	}
	switch scope {
	case "admin":
		h.logoutAdminSession(ctx)
	case "user":
		h.logoutUserSession(ctx)
	default:
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid logout scope; use \"admin\" or \"user\"")
	}
}

func (h *SessionHandler) logoutAdminSession(ctx *fasthttp.RequestCtx) {
	tokensToDelete := make([]string, 0, 2)

	adminToken := adminSessionTokenFromCookie(ctx)
	clearNamedSessionCookie(ctx, adminSessionCookieName)
	if adminToken != "" {
		tokensToDelete = append(tokensToDelete, adminToken)
	}

	// Legacy admin sessions lived in the user cookie before admin_token was split out.
	userToken := userSessionTokenFromCookie(ctx)
	if userToken != "" {
		session, err := h.configStore.GetSession(ctx, userToken)
		if err == nil && session != nil && (session.AoneUserID == nil || strings.TrimSpace(*session.AoneUserID) == "") {
			clearNamedSessionCookie(ctx, userSessionCookieName)
			tokensToDelete = append(tokensToDelete, userToken)
		}
	}

	for _, token := range tokensToDelete {
		if err := h.configStore.DeleteSession(ctx, token); err != nil && !errors.Is(err, configstore.ErrNotFound) {
			logger.Error("failed to delete admin session during logout: %v", err)
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to invalidate session. Please try again.")
			return
		}
	}

	SendJSON(ctx, map[string]any{
		"message": "Logout successful",
	})
}

func (h *SessionHandler) logoutUserSession(ctx *fasthttp.RequestCtx) {
	// Get token from Authorization header
	token := string(ctx.Request.Header.Peek("Authorization"))
	token = strings.TrimPrefix(token, "Bearer ")

	// If no token in header, try to get from cookie
	if token == "" {
		token = userSessionTokenFromCookie(ctx)
	}

	clearNamedSessionCookie(ctx, userSessionCookieName)

	// delete session from database if token exists
	if token != "" {
		if session, sessErr := h.configStore.GetSession(ctx, token); sessErr == nil && session != nil &&
			session.AoneUserID != nil && strings.TrimSpace(*session.AoneUserID) != "" {
			aoneUserID := strings.TrimSpace(*session.AoneUserID)
			loginSource := strings.TrimSpace(session.LoginSource)
			if loginSource == "" {
				loginSource = loginSourceDashboard
			}
			otherSessions, countErr := h.configStore.CountActiveAoneUserSessions(ctx, aoneUserID, loginSource, token)
			if countErr != nil {
				logger.Warn("failed to count active sessions during logout: %v", countErr)
			}
			if session.DeviceAuthorizationID != nil && *session.DeviceAuthorizationID > 0 {
				if _, revokeErr := h.configStore.SetAoneDeviceAuthorizationStatus(ctx, *session.DeviceAuthorizationID, false); revokeErr != nil {
					logger.Warn("failed to revoke device authorization during logout: %v", revokeErr)
				}
			}
			if err := h.configStore.DeleteAoneUserOAuthTokenForSession(ctx, aoneUserID, loginSource, token); err != nil {
				logger.Warn("failed to delete session oauth tokens during logout: %v", err)
			}
			if otherSessions == 0 {
				if err := h.configStore.DeleteLegacyAoneUserOAuthToken(ctx, aoneUserID, loginSource); err != nil {
					logger.Warn("failed to delete legacy oauth tokens during logout: %v", err)
				}
			}
		}
		err := h.configStore.DeleteSession(ctx, token)
		if err != nil && !errors.Is(err, configstore.ErrNotFound) {
			logger.Error("failed to delete session during logout: %v", err)
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to invalidate session. Please try again.")
			return
		}
	}

	SendJSON(ctx, map[string]any{
		"message": "Logout successful",
	})
}

// issueWSTicket handles POST /api/session/ws-ticket - Issue a short-lived ticket for WebSocket auth.
// The caller must already be authenticated (via cookie or Authorization header).
// Returns a one-time-use ticket that the frontend passes as ?ticket= when opening the WebSocket.
func (h *SessionHandler) issueWSTicket(ctx *fasthttp.RequestCtx) {
	if h.wsTicketStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "WebSocket tickets are not available")
		return
	}
	sessionToken, ok := ctx.UserValue(schemas.BifrostContextKeySessionToken).(string)
	if !ok {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
		return
	}
	if sessionToken == "" {
		// This is the case where auth is not configured or not enabled
		sessionToken = "dummy-session"
	}
	ticket, err := h.wsTicketStore.Issue(sessionToken)
	if err != nil {
		logger.Error("failed to issue WS ticket: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to issue WebSocket ticket")
		return
	}
	SendJSON(ctx, map[string]any{
		"ticket": ticket,
	})
}
