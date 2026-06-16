package handlers

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/valyala/fasthttp"
)

type dualSessionStore struct {
	sessions map[string]*tables.SessionsTable
}

func (s *dualSessionStore) GetSession(_ context.Context, token string) (*tables.SessionsTable, error) {
	session, ok := s.sessions[token]
	if !ok {
		return nil, nil
	}
	return session, nil
}

func TestResolveDashboardAuthSessionPrefersUserCookie(t *testing.T) {
	aoneUserID := "aone-123"
	store := &dualSessionStore{
		sessions: map[string]*tables.SessionsTable{
			"user-token": {
				Token:      "user-token",
				ExpiresAt:  time.Now().Add(time.Hour),
				AoneUserID: &aoneUserID,
			},
			"admin-token": {
				Token:     "admin-token",
				ExpiresAt: time.Now().Add(time.Hour),
			},
		},
	}

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetCookie(userSessionCookieName, "user-token")
	ctx.Request.Header.SetCookie(adminSessionCookieName, "admin-token")

	sessionToken := resolveDashboardAuthSession(ctx, store, func(_ *fasthttp.RequestCtx, token string) bool {
		return token == "user-token"
	})
	if sessionToken != "user-token" {
		t.Fatalf("expected user session token, got %q", sessionToken)
	}
	isLocalAdmin, ok := ctx.UserValue(schemas.IsLocalAdminContextKey).(bool)
	if !ok || !isLocalAdmin {
		t.Fatal("expected local admin context from admin cookie")
	}
}

func TestResolveDashboardAuthSessionUsesAdminWhenUserMissing(t *testing.T) {
	store := &dualSessionStore{
		sessions: map[string]*tables.SessionsTable{
			"admin-token": {
				Token:     "admin-token",
				ExpiresAt: time.Now().Add(time.Hour),
			},
		},
	}

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetCookie(adminSessionCookieName, "admin-token")

	sessionToken := resolveDashboardAuthSession(ctx, store, func(_ *fasthttp.RequestCtx, _ string) bool {
		return false
	})
	if sessionToken != "admin-token" {
		t.Fatalf("expected admin session token, got %q", sessionToken)
	}
}

func TestUserAndAdminSessionCookiesAreDistinct(t *testing.T) {
	if userSessionCookieName == adminSessionCookieName {
		t.Fatal("user and admin session cookies must use different names")
	}
}

func TestSessionCookiePathUsesConfiguredBasePath(t *testing.T) {
	SetSessionCookieBasePath("/zai")
	t.Cleanup(func() { SetSessionCookieBasePath("") })

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI("/api/session/login")

	if got := sessionCookiePath(ctx); got != "/zai" {
		t.Fatalf("sessionCookiePath = %q, want /zai", got)
	}

	paths := sessionCookieSetPaths()
	if len(paths) != 2 || paths[0] != "/zai" || paths[1] != "/" {
		t.Fatalf("sessionCookieSetPaths() = %v, want [/zai /]", paths)
	}

	setUserSessionCookie(ctx, "user-token", time.Now().Add(time.Hour))
	setCookies := collectSetCookieHeaders(ctx)
	if len(setCookies) == 0 {
		t.Fatal("expected Set-Cookie headers")
	}
	joined := strings.ToLower(strings.Join(setCookies, "\n"))
	if !strings.Contains(joined, "token=user-token") {
		t.Fatalf("expected user token cookie, got %q", joined)
	}
	if !strings.Contains(joined, "path=/") && !strings.Contains(joined, "path=/zai") {
		t.Fatalf("expected cookie path / or /zai, got %q", joined)
	}
}

func collectSetCookieHeaders(ctx *fasthttp.RequestCtx) []string {
	var cookies []string
	ctx.Response.Header.VisitAll(func(key, value []byte) {
		if strings.EqualFold(string(key), "Set-Cookie") {
			cookies = append(cookies, string(value))
		}
	})
	return cookies
}

func TestSessionCookiePathDefaultsToRoot(t *testing.T) {
	SetSessionCookieBasePath("")
	t.Cleanup(func() { SetSessionCookieBasePath("") })

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI("/api/session/login")

	if got := sessionCookiePath(ctx); got != "/" {
		t.Fatalf("sessionCookiePath = %q, want /", got)
	}
}

func TestAdminSessionCookieIgnoresAdminLoginReferer(t *testing.T) {
	SetSessionCookieBasePath("")
	t.Cleanup(func() { SetSessionCookieBasePath("") })

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI("/api/session/login")
	ctx.Request.Header.Set("Referer", "http://localhost:8080/admin-login")

	setAdminSessionCookie(ctx, "admin-token", time.Now().Add(time.Hour))
	setCookie := strings.ToLower(string(ctx.Response.Header.Peek("Set-Cookie")))
	if !strings.Contains(setCookie, "admin_token=admin-token") {
		t.Fatalf("expected admin_token cookie, got %q", setCookie)
	}
	if strings.Contains(setCookie, "path=/admin") {
		t.Fatalf("admin login must not scope cookie to /admin, got %q", setCookie)
	}
	if !strings.Contains(setCookie, "path=/") {
		t.Fatalf("expected root path cookie, got %q", setCookie)
	}
}
