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

	setUserSessionCookie(ctx, "user-token", time.Now().Add(time.Hour))
	setCookie := string(ctx.Response.Header.Peek("Set-Cookie"))
	if !strings.Contains(strings.ToLower(setCookie), "path=/zai") {
		t.Fatalf("expected subpath cookie, got %q", setCookie)
	}
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
