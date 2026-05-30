package handlers

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/valyala/fasthttp"
)

type localAdminSessionStore struct {
	sessions map[string]*tables.SessionsTable
}

func (s *localAdminSessionStore) GetSession(_ context.Context, token string) (*tables.SessionsTable, error) {
	session, ok := s.sessions[token]
	if !ok {
		return nil, nil
	}
	return session, nil
}

func TestValidateLocalAdminSession(t *testing.T) {
	aoneUserID := "aone-123"
	store := &localAdminSessionStore{
		sessions: map[string]*tables.SessionsTable{
			"admin-token": {
				Token:     "admin-token",
				ExpiresAt: time.Now().Add(time.Hour),
			},
			"aone-token": {
				Token:      "aone-token",
				ExpiresAt:  time.Now().Add(time.Hour),
				AoneUserID: &aoneUserID,
			},
		},
	}

	if !validateLocalAdminSession(store, "admin-token") {
		t.Fatal("expected admin session to be local admin")
	}
	if validateLocalAdminSession(store, "aone-token") {
		t.Fatal("expected aone session not to be local admin")
	}
}

type mockAuthConfigOnlyStore struct {
	configstore.ConfigStore
	authConfig *configstore.AuthConfig
}

func (m *mockAuthConfigOnlyStore) GetAuthConfig(_ context.Context) (*configstore.AuthConfig, error) {
	return m.authConfig, nil
}

func TestRequireLocalAdmin(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	if requireLocalAdmin(ctx, nil) {
		t.Fatal("expected missing config store to deny admin access")
	}

	ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
	handlerStore := &mockAuthConfigOnlyStore{
		authConfig: &configstore.AuthConfig{IsEnabled: true},
	}
	if !requireLocalAdmin(ctx, handlerStore) {
		t.Fatal("expected local admin context to pass")
	}

	ctx.SetUserValue(schemas.IsLocalAdminContextKey, false)
	if requireLocalAdmin(ctx, handlerStore) {
		t.Fatal("expected non-admin context to fail")
	}

	authDisabledStore := &mockAuthConfigOnlyStore{
		authConfig: &configstore.AuthConfig{IsEnabled: false},
	}
	ctxDelAdmin := &fasthttp.RequestCtx{}
	if !requireLocalAdmin(ctxDelAdmin, authDisabledStore) {
		t.Fatal("expected auth-disabled deployment to allow admin operations")
	}
}
