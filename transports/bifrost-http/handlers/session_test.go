package handlers

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/valyala/fasthttp"
)

type mockIsAuthEnabledStore struct {
	configstore.ConfigStore
	authConfig *configstore.AuthConfig
	sessions   map[string]*tables.SessionsTable
}

func (s *mockIsAuthEnabledStore) GetAuthConfig(_ context.Context) (*configstore.AuthConfig, error) {
	return s.authConfig, nil
}

func (s *mockIsAuthEnabledStore) GetSession(_ context.Context, token string) (*tables.SessionsTable, error) {
	session, ok := s.sessions[token]
	if !ok {
		return nil, nil
	}
	return session, nil
}

func TestIsAuthEnabledReportsLocalAdminWithConcurrentUserSession(t *testing.T) {
	aoneUserID := "aone-123"
	store := &mockIsAuthEnabledStore{
		authConfig: &configstore.AuthConfig{IsEnabled: true},
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

	handler := NewSessionHandler(store, nil, nil)
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetCookie(userSessionCookieName, "user-token")
	ctx.Request.Header.SetCookie(adminSessionCookieName, "admin-token")
	handler.isAuthEnabled(ctx)

	if ctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Fatalf("expected 200, got %d", ctx.Response.StatusCode())
	}

	var payload map[string]any
	if err := json.Unmarshal(ctx.Response.Body(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["is_aone_user_session"] != true {
		t.Fatalf("expected aone user session, got %#v", payload["is_aone_user_session"])
	}
	if payload["is_local_admin_session"] != true {
		t.Fatalf("expected local admin session with admin cookie, got %#v", payload["is_local_admin_session"])
	}
}

type mockSessionLogoutStore struct {
	configstore.ConfigStore
	authConfig      *configstore.AuthConfig
	sessions        map[string]*tables.SessionsTable
	deletedSessions []string
}

func (s *mockSessionLogoutStore) GetAuthConfig(_ context.Context) (*configstore.AuthConfig, error) {
	return s.authConfig, nil
}

func (s *mockSessionLogoutStore) GetSession(_ context.Context, token string) (*tables.SessionsTable, error) {
	session, ok := s.sessions[token]
	if !ok {
		return nil, nil
	}
	return session, nil
}

func (s *mockSessionLogoutStore) DeleteSession(_ context.Context, token string) error {
	delete(s.sessions, token)
	s.deletedSessions = append(s.deletedSessions, token)
	return nil
}

func TestLogoutAdminSessionClearsLegacyUserCookie(t *testing.T) {
	store := &mockSessionLogoutStore{
		authConfig: &configstore.AuthConfig{IsEnabled: true},
		sessions: map[string]*tables.SessionsTable{
			"legacy-admin-token": {
				Token:     "legacy-admin-token",
				ExpiresAt: time.Now().Add(time.Hour),
			},
		},
	}

	handler := NewSessionHandler(store, nil, nil)
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI("/api/session/logout")
	ctx.Request.Header.SetMethod("POST")
	ctx.Request.Header.SetCookie(userSessionCookieName, "legacy-admin-token")
	ctx.Request.SetBodyString(`{"scope":"admin"}`)
	handler.logout(ctx)

	if ctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%q", ctx.Response.StatusCode(), string(ctx.Response.Body()))
	}
	if len(store.deletedSessions) != 1 || store.deletedSessions[0] != "legacy-admin-token" {
		t.Fatalf("expected legacy admin session deleted, got %#v", store.deletedSessions)
	}
	setCookie := string(ctx.Response.Header.Peek("Set-Cookie"))
	if !strings.Contains(setCookie, userSessionCookieName+"=") {
		t.Fatalf("expected user session cookie cleared, got %q", setCookie)
	}
}

func TestLogoutAdminSessionPreservesAoneUserCookie(t *testing.T) {
	aoneUserID := "aone-123"
	store := &mockSessionLogoutStore{
		authConfig: &configstore.AuthConfig{IsEnabled: true},
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

	handler := NewSessionHandler(store, nil, nil)
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI("/api/session/logout")
	ctx.Request.Header.SetMethod("POST")
	ctx.Request.Header.SetCookie(userSessionCookieName, "user-token")
	ctx.Request.Header.SetCookie(adminSessionCookieName, "admin-token")
	ctx.Request.SetBodyString(`{"scope":"admin"}`)
	handler.logout(ctx)

	if ctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Fatalf("expected 200, got %d", ctx.Response.StatusCode())
	}
	if len(store.deletedSessions) != 1 || store.deletedSessions[0] != "admin-token" {
		t.Fatalf("expected only admin session deleted, got %#v", store.deletedSessions)
	}
	if _, ok := store.sessions["user-token"]; !ok {
		t.Fatal("expected aone user session to remain")
	}
}

type mockAdminLoginStore struct {
	configstore.ConfigStore
	authConfig *configstore.AuthConfig
	sessions   map[string]*tables.SessionsTable
}

func (s *mockAdminLoginStore) GetAuthConfig(_ context.Context) (*configstore.AuthConfig, error) {
	return s.authConfig, nil
}

func (s *mockAdminLoginStore) CreateSession(_ context.Context, session *tables.SessionsTable) error {
	if s.sessions == nil {
		s.sessions = make(map[string]*tables.SessionsTable)
	}
	s.sessions[session.Token] = session
	return nil
}

func (s *mockAdminLoginStore) GetSession(_ context.Context, token string) (*tables.SessionsTable, error) {
	session, ok := s.sessions[token]
	if !ok {
		return nil, nil
	}
	return session, nil
}

func TestAdminLoginFormSetsCookieAndRedirects(t *testing.T) {
	SetSessionCookieBasePath("")
	t.Cleanup(func() { SetSessionCookieBasePath("") })

	hashedPassword, err := encrypt.Hash("password")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	store := &mockAdminLoginStore{
		authConfig: &configstore.AuthConfig{
			IsEnabled:     true,
			AdminUserName: schemas.NewEnvVar("admin"),
			AdminPassword: schemas.NewEnvVar(hashedPassword),
		},
		sessions: make(map[string]*tables.SessionsTable),
	}

	handler := NewSessionHandler(store, nil, nil)
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI("/api/session/admin-login")
	ctx.Request.Header.SetHost("localhost:8080")
	ctx.Request.Header.SetMethod("POST")
	ctx.Request.Header.SetContentType("application/x-www-form-urlencoded")
	ctx.Request.SetBodyString("username=admin&password=password&return_to=/workspace/dashboard")
	handler.adminLoginForm(ctx)

	if ctx.Response.StatusCode() != fasthttp.StatusSeeOther {
		t.Fatalf("expected 303, got %d body=%q", ctx.Response.StatusCode(), string(ctx.Response.Body()))
	}
	location := string(ctx.Response.Header.Peek("Location"))
	if !strings.Contains(location, "/api/session/admin-login/establish?ticket=") {
		t.Fatalf("expected establish redirect, got %q", location)
	}
	if strings.Contains(location, "/workspace/dashboard") {
		t.Fatalf("form login must not redirect directly to dashboard, got %q", location)
	}
	setCookie := strings.ToLower(string(ctx.Response.Header.Peek("Set-Cookie")))
	if strings.Contains(setCookie, "admin_token=") {
		t.Fatalf("cookie should be set by establish endpoint, got %q", setCookie)
	}
	if len(store.sessions) != 1 {
		t.Fatalf("expected one created session, got %d", len(store.sessions))
	}
}

func TestAdminLoginFormWrongPasswordStaysOnAdminLogin(t *testing.T) {
	SetSessionCookieBasePath("")
	t.Cleanup(func() { SetSessionCookieBasePath("") })

	hashedPassword, err := encrypt.Hash("password")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	store := &mockAdminLoginStore{
		authConfig: &configstore.AuthConfig{
			IsEnabled:     true,
			AdminUserName: schemas.NewEnvVar("admin"),
			AdminPassword: schemas.NewEnvVar(hashedPassword),
		},
		sessions: make(map[string]*tables.SessionsTable),
	}

	handler := NewSessionHandler(store, nil, nil)
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI("/api/session/admin-login")
	ctx.Request.Header.SetHost("localhost:8080")
	ctx.Request.Header.SetMethod("POST")
	ctx.Request.Header.SetContentType("application/x-www-form-urlencoded")
	ctx.Request.SetBodyString("username=admin&password=wrong&return_to=/workspace/dashboard")
	handler.adminLoginForm(ctx)

	if ctx.Response.StatusCode() != fasthttp.StatusSeeOther {
		t.Fatalf("expected 303, got %d body=%q", ctx.Response.StatusCode(), string(ctx.Response.Body()))
	}
	location := string(ctx.Response.Header.Peek("Location"))
	if strings.Contains(location, "/workspace/dashboard") {
		t.Fatalf("wrong password must not redirect to dashboard, got %q", location)
	}
	if !strings.Contains(location, "/admin-login") || !strings.Contains(location, "error=") {
		t.Fatalf("expected admin-login error redirect, got %q", location)
	}
	if len(store.sessions) != 0 {
		t.Fatalf("expected no session created, got %d", len(store.sessions))
	}
}

func TestAdminLoginEstablishSetsCookieAndRedirects(t *testing.T) {
	SetSessionCookieBasePath("")
	t.Cleanup(func() { SetSessionCookieBasePath("") })

	hashedPassword, err := encrypt.Hash("password")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	store := &mockAdminLoginStore{
		authConfig: &configstore.AuthConfig{
			IsEnabled:     true,
			AdminUserName: schemas.NewEnvVar("admin"),
			AdminPassword: schemas.NewEnvVar(hashedPassword),
		},
		sessions: make(map[string]*tables.SessionsTable),
	}

	handler := NewSessionHandler(store, nil, NewAdminEstablishTicketStore())
	loginCtx := &fasthttp.RequestCtx{}
	loginCtx.Request.SetRequestURI("/api/session/admin-login")
	loginCtx.Request.Header.SetMethod("POST")
	loginCtx.Request.Header.SetContentType("application/x-www-form-urlencoded")
	loginCtx.Request.SetBodyString("username=admin&password=password")
	handler.adminLoginForm(loginCtx)

	location := string(loginCtx.Response.Header.Peek("Location"))
	ticketPrefix := "/api/session/admin-login/establish?ticket="
	idx := strings.Index(location, ticketPrefix)
	if idx < 0 {
		t.Fatalf("expected establish redirect, got %q", location)
	}

	establishCtx := &fasthttp.RequestCtx{}
	establishCtx.Request.SetRequestURI(location[idx:])
	establishCtx.Request.Header.SetHost("localhost:8080")
	establishCtx.Request.Header.SetMethod("GET")
	handler.adminLoginEstablish(establishCtx)

	if establishCtx.Response.StatusCode() != fasthttp.StatusSeeOther {
		t.Fatalf("expected 303, got %d", establishCtx.Response.StatusCode())
	}
	finalLocation := string(establishCtx.Response.Header.Peek("Location"))
	if !strings.Contains(finalLocation, "/workspace/dashboard") {
		t.Fatalf("expected dashboard redirect, got %q", finalLocation)
	}
	setCookie := strings.ToLower(string(establishCtx.Response.Header.Peek("Set-Cookie")))
	if !strings.Contains(setCookie, "admin_token=") || !strings.Contains(setCookie, "path=/") {
		t.Fatalf("expected admin_token cookie, got %q", setCookie)
	}
}

func TestIsAuthEnabledReportsLocalAdminFromAdminCookieOnly(t *testing.T) {
	store := &mockIsAuthEnabledStore{
		authConfig: &configstore.AuthConfig{IsEnabled: true},
		sessions: map[string]*tables.SessionsTable{
			"admin-token": {
				Token:     "admin-token",
				ExpiresAt: time.Now().Add(time.Hour),
			},
		},
	}

	handler := NewSessionHandler(store, nil, nil)
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetCookie(adminSessionCookieName, "admin-token")
	handler.isAuthEnabled(ctx)

	var payload map[string]any
	if err := json.Unmarshal(ctx.Response.Body(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["is_local_admin_session"] != true {
		t.Fatalf("expected local admin session, got %#v", payload["is_local_admin_session"])
	}
	if payload["has_valid_token"] != true {
		t.Fatalf("expected valid token, got %#v", payload["has_valid_token"])
	}
}
