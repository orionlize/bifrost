package handlers

import (
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

const (
	userSessionCookieName  = "token"
	adminSessionCookieName = "admin_token"
)

var configuredSessionCookieBasePath string

// SetSessionCookieBasePath configures the server base path used to scope session cookies.
func SetSessionCookieBasePath(basePath string) {
	configuredSessionCookieBasePath = lib.NormalizeBasePath(basePath)
}

func userSessionTokenFromCookie(ctx *fasthttp.RequestCtx) string {
	return strings.TrimSpace(string(ctx.Request.Header.Cookie(userSessionCookieName)))
}

func adminSessionTokenFromCookie(ctx *fasthttp.RequestCtx) string {
	return strings.TrimSpace(string(ctx.Request.Header.Cookie(adminSessionCookieName)))
}

func dashboardSessionTokenFromRequest(ctx *fasthttp.RequestCtx) string {
	if authHeader := string(ctx.Request.Header.Peek("Authorization")); strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	}
	return userSessionTokenFromCookie(ctx)
}

func setUserSessionCookie(ctx *fasthttp.RequestCtx, token string, expiresAt time.Time) {
	writeSessionCookieAtPath(ctx, userSessionCookieName, token, expiresAt, sessionCookiePath(ctx))
}

func setAdminSessionCookie(ctx *fasthttp.RequestCtx, token string, expiresAt time.Time) {
	for _, path := range sessionCookieSetPaths() {
		writeSessionCookieAtPath(ctx, adminSessionCookieName, token, expiresAt, path)
	}
}

func sessionCookieSetPaths() []string {
	primary := sessionCookiePath(nil)
	if primary == "/" {
		return []string{"/"}
	}
	return []string{primary, "/"}
}

func clearNamedSessionCookie(ctx *fasthttp.RequestCtx, name string) {
	for _, path := range sessionCookieClearPaths(ctx) {
		clearNamedSessionCookieAtPath(ctx, name, path)
	}
}

func sessionCookieClearPaths(ctx *fasthttp.RequestCtx) []string {
	seen := make(map[string]struct{})
	var paths []string
	add := func(path string) {
		if path == "" {
			path = "/"
		}
		if _, ok := seen[path]; ok {
			return
		}
		seen[path] = struct{}{}
		paths = append(paths, path)
	}
	add(sessionCookiePath(ctx))
	add("/")
	add("/admin") // legacy admin_token cookies scoped to /admin from referer mis-inference
	if configured := lib.SessionCookiePath(configuredSessionCookieBasePath); configured != "" {
		add(configured)
	}
	if ctx != nil {
		if bp := basePathFromForwardedHeaders(ctx); bp != "" {
			add(lib.SessionCookiePath(bp))
		}
		if bp := basePathFromReferer(ctx); bp != "" {
			add(lib.SessionCookiePath(bp))
		}
	}
	return paths
}

func writeSessionCookieAtPath(ctx *fasthttp.RequestCtx, name, token string, expiresAt time.Time, path string) {
	cookie := fasthttp.AcquireCookie()
	defer fasthttp.ReleaseCookie(cookie)
	cookie.SetKey(name)
	cookie.SetValue(token)
	cookie.SetExpire(expiresAt)
	cookie.SetPath(path)
	cookie.SetHTTPOnly(true)
	cookie.SetSameSite(fasthttp.CookieSameSiteLaxMode)
	if lib.IsHTTPSRequest(ctx) {
		cookie.SetSecure(true)
	}
	ctx.Response.Header.SetCookie(cookie)
}

func clearNamedSessionCookieAtPath(ctx *fasthttp.RequestCtx, name, path string) {
	cookie := fasthttp.AcquireCookie()
	defer fasthttp.ReleaseCookie(cookie)
	cookie.SetKey(name)
	cookie.SetValue("")
	cookie.SetExpire(time.Now().Add(-time.Hour * 24 * 30))
	cookie.SetPath(path)
	cookie.SetHTTPOnly(true)
	cookie.SetSameSite(fasthttp.CookieSameSiteLaxMode)
	if lib.IsHTTPSRequest(ctx) {
		cookie.SetSecure(true)
	}
	ctx.Response.Header.SetCookie(cookie)
}

func sessionCookiePath(_ *fasthttp.RequestCtx) string {
	// Session cookies must use the server-configured base path only. Inferring from
	// Referer is unsafe: /admin-login used to match the "/login" suffix and set
	// Path=/admin, so admin_token was never sent on /api/* requests.
	return lib.SessionCookiePath(configuredSessionCookieBasePath)
}

// resolveDashboardAuthSession authenticates cookie-based dashboard requests.
// Aone user and local-admin sessions use separate cookies so both can coexist
// in the same browser. When both are present, the user session drives
// BifrostContextKeySessionToken while the admin cookie sets IsLocalAdminContextKey.
func resolveDashboardAuthSession(
	ctx *fasthttp.RequestCtx,
	store sessionReader,
	validateUserSession func(ctx *fasthttp.RequestCtx, token string) bool,
) string {
	userToken := userSessionTokenFromCookie(ctx)
	adminToken := adminSessionTokenFromCookie(ctx)

	var sessionToken string
	if userToken != "" && validateUserSession(ctx, userToken) {
		sessionToken = userToken
	}
	if adminToken != "" && validateLocalAdminSession(store, adminToken) {
		ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
		if sessionToken == "" {
			sessionToken = adminToken
		}
	}
	return sessionToken
}

// dashboardSessionTokenFromCookie returns a valid dashboard session token from
// either cookie, preferring the Aone user session when both are present.
func dashboardSessionTokenFromCookie(store configstore.ConfigStore, ctx *fasthttp.RequestCtx) string {
	userToken := userSessionTokenFromCookie(ctx)
	if userToken != "" && validateSession(ctx, store, userToken) {
		return userToken
	}
	adminToken := adminSessionTokenFromCookie(ctx)
	if adminToken != "" && validateLocalAdminSession(store, adminToken) {
		return adminToken
	}
	return ""
}
