package handlers

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
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

	handler := NewSessionHandler(store, nil)
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

	handler := NewSessionHandler(store, nil)
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
