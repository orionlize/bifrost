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
	setNamedSessionCookie(ctx, userSessionCookieName, token, expiresAt)
}

func setAdminSessionCookie(ctx *fasthttp.RequestCtx, token string, expiresAt time.Time) {
	setNamedSessionCookie(ctx, adminSessionCookieName, token, expiresAt)
}

func clearNamedSessionCookie(ctx *fasthttp.RequestCtx, name string) {
	cookie := fasthttp.AcquireCookie()
	defer fasthttp.ReleaseCookie(cookie)
	cookie.SetKey(name)
	cookie.SetValue("")
	cookie.SetExpire(time.Now().Add(-time.Hour * 24 * 30))
	cookie.SetPath("/")
	cookie.SetHTTPOnly(true)
	cookie.SetSameSite(fasthttp.CookieSameSiteLaxMode)
	if lib.IsHTTPSRequest(ctx) {
		cookie.SetSecure(true)
	}
	ctx.Response.Header.SetCookie(cookie)
}

func setNamedSessionCookie(ctx *fasthttp.RequestCtx, name, token string, expiresAt time.Time) {
	cookie := fasthttp.AcquireCookie()
	defer fasthttp.ReleaseCookie(cookie)
	cookie.SetKey(name)
	cookie.SetValue(token)
	cookie.SetExpire(expiresAt)
	cookie.SetPath("/")
	cookie.SetHTTPOnly(true)
	cookie.SetSameSite(fasthttp.CookieSameSiteLaxMode)
	if lib.IsHTTPSRequest(ctx) {
		cookie.SetSecure(true)
	}
	ctx.Response.Header.SetCookie(cookie)
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
