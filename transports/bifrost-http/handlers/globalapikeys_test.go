package handlers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/valyala/fasthttp"
)

type mockGlobalAPIKeyStore struct {
	configstore.ConfigStore
	authConfig *configstore.AuthConfig
	keys       []tables.GlobalAPIKey
}

func (m *mockGlobalAPIKeyStore) GetAuthConfig(_ context.Context) (*configstore.AuthConfig, error) {
	return m.authConfig, nil
}

func (m *mockGlobalAPIKeyStore) ListGlobalAPIKeys(_ context.Context) ([]tables.GlobalAPIKey, error) {
	return m.keys, nil
}

func (m *mockGlobalAPIKeyStore) CreateGlobalAPIKey(_ context.Context, name string) (*tables.GlobalAPIKey, string, error) {
	key := &tables.GlobalAPIKey{
		ID:          "key-1",
		Name:        name,
		TokenPrefix: "bf-ak-abcd...",
		IsActive:    true,
	}
	m.keys = append([]tables.GlobalAPIKey{*key}, m.keys...)
	return key, "bf-ak-abcd1234", nil
}

func (m *mockGlobalAPIKeyStore) SetGlobalAPIKeyActive(_ context.Context, id string, isActive bool) (*tables.GlobalAPIKey, error) {
	for i, key := range m.keys {
		if key.ID == id {
			m.keys[i].IsActive = isActive
			return &m.keys[i], nil
		}
	}
	return nil, configstore.ErrGlobalAPIKeyNotFound
}

func (m *mockGlobalAPIKeyStore) DeleteGlobalAPIKey(_ context.Context, id string) error {
	for i, key := range m.keys {
		if key.ID == id {
			m.keys = append(m.keys[:i], m.keys[i+1:]...)
			return nil
		}
	}
	return configstore.ErrGlobalAPIKeyNotFound
}

func TestGlobalAPIKeysCreateRequiresAdmin(t *testing.T) {
	handler := &GlobalAPIKeysHandler{
		configStore: &mockGlobalAPIKeyStore{
			authConfig: &configstore.AuthConfig{IsEnabled: true},
		},
	}
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodPost)
	ctx.Request.SetRequestURI("/api/settings/api-keys")
	ctx.Request.SetBodyString(`{"name":"ci"}`)

	handler.create(ctx)
	if ctx.Response.StatusCode() != fasthttp.StatusForbidden {
		t.Fatalf("status = %d, want %d", ctx.Response.StatusCode(), fasthttp.StatusForbidden)
	}
}

func TestGlobalAPIKeysCreateSuccess(t *testing.T) {
	handler := &GlobalAPIKeysHandler{
		configStore: &mockGlobalAPIKeyStore{
			authConfig: &configstore.AuthConfig{IsEnabled: true},
		},
	}
	ctx := &fasthttp.RequestCtx{}
	ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
	ctx.Request.Header.SetMethod(fasthttp.MethodPost)
	ctx.Request.SetRequestURI("/api/settings/api-keys")
	ctx.Request.SetBodyString(`{"name":"ci"}`)

	handler.create(ctx)
	if ctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", ctx.Response.StatusCode(), fasthttp.StatusOK, string(ctx.Response.Body()))
	}

	var payload map[string]any
	if err := json.Unmarshal(ctx.Response.Body(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload["token"] != "bf-ak-abcd1234" {
		t.Fatalf("token = %v", payload["token"])
	}
}

func TestGlobalAPIKeysUpdateRequiresAdmin(t *testing.T) {
	handler := &GlobalAPIKeysHandler{
		configStore: &mockGlobalAPIKeyStore{
			authConfig: &configstore.AuthConfig{IsEnabled: true},
			keys:       []tables.GlobalAPIKey{{ID: "key-1", Name: "ci", IsActive: true}},
		},
	}
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodPut)
	ctx.Request.SetRequestURI("/api/settings/api-keys/key-1")
	ctx.Request.SetBodyString(`{"is_active":false}`)
	ctx.SetUserValue("id", "key-1")

	handler.update(ctx)
	if ctx.Response.StatusCode() != fasthttp.StatusForbidden {
		t.Fatalf("status = %d, want %d", ctx.Response.StatusCode(), fasthttp.StatusForbidden)
	}
}

func TestGlobalAPIKeysUpdateDisableSuccess(t *testing.T) {
	store := &mockGlobalAPIKeyStore{
		authConfig: &configstore.AuthConfig{IsEnabled: true},
		keys:       []tables.GlobalAPIKey{{ID: "key-1", Name: "ci", IsActive: true}},
	}
	handler := &GlobalAPIKeysHandler{configStore: store}
	ctx := &fasthttp.RequestCtx{}
	ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
	ctx.SetUserValue("id", "key-1")
	ctx.Request.Header.SetMethod(fasthttp.MethodPut)
	ctx.Request.SetRequestURI("/api/settings/api-keys/key-1")
	ctx.Request.SetBodyString(`{"is_active":false}`)

	handler.update(ctx)
	if ctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", ctx.Response.StatusCode(), fasthttp.StatusOK, string(ctx.Response.Body()))
	}
	if store.keys[0].IsActive {
		t.Fatal("expected key to be disabled")
	}
}

func TestGlobalAPIKeysDeleteSuccess(t *testing.T) {
	store := &mockGlobalAPIKeyStore{
		authConfig: &configstore.AuthConfig{IsEnabled: true},
		keys:       []tables.GlobalAPIKey{{ID: "key-1", Name: "ci", IsActive: true}},
	}
	handler := &GlobalAPIKeysHandler{configStore: store}
	ctx := &fasthttp.RequestCtx{}
	ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
	ctx.SetUserValue("id", "key-1")
	ctx.Request.Header.SetMethod(fasthttp.MethodDelete)
	ctx.Request.SetRequestURI("/api/settings/api-keys/key-1")

	handler.delete(ctx)
	if ctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", ctx.Response.StatusCode(), fasthttp.StatusOK, string(ctx.Response.Body()))
	}
	if len(store.keys) != 0 {
		t.Fatalf("expected key to be deleted, got %d keys", len(store.keys))
	}
}
