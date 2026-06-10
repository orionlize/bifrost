package handlers

import (
	"context"
	"encoding/json"
	"testing"
	"time"

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

func (m *mockGlobalAPIKeyStore) CreateGlobalAPIKey(_ context.Context, name string, allowedUserIDs []string) (*tables.GlobalAPIKey, string, error) {
	key := &tables.GlobalAPIKey{
		ID:             "key-1",
		Name:           name,
		TokenPrefix:    "bf-ak-abcd...",
		TokenEncrypted: "bf-ak-abcd1234",
		IsActive:       true,
		AllowedUserIDs: allowedUserIDs,
	}
	m.keys = append([]tables.GlobalAPIKey{*key}, m.keys...)
	return key, "bf-ak-abcd1234", nil
}

func (m *mockGlobalAPIKeyStore) ListActiveGlobalAPIKeys(_ context.Context) ([]tables.GlobalAPIKey, error) {
	active := make([]tables.GlobalAPIKey, 0, len(m.keys))
	for _, key := range m.keys {
		if key.IsActive {
			active = append(active, key)
		}
	}
	return active, nil
}

func (m *mockGlobalAPIKeyStore) ListAssignedGlobalAPIKeysForUser(_ context.Context, userID string) ([]tables.GlobalAPIKey, error) {
	assigned := make([]tables.GlobalAPIKey, 0, len(m.keys))
	for _, key := range m.keys {
		if configstore.IsGlobalAPIKeyAssignedToUser(key, userID) {
			assigned = append(assigned, key)
		}
	}
	return assigned, nil
}

func (m *mockGlobalAPIKeyStore) GetSession(_ context.Context, token string) (*tables.SessionsTable, error) {
	if token != "session-token" {
		return nil, nil
	}
	aoneUserID := "user-1"
	return &tables.SessionsTable{
		Token:      token,
		AoneUserID: &aoneUserID,
		ExpiresAt:  time.Now().Add(time.Hour),
	}, nil
}

func (m *mockGlobalAPIKeyStore) UpdateGlobalAPIKey(_ context.Context, id string, update configstore.GlobalAPIKeyUpdate) (*tables.GlobalAPIKey, error) {
	for i, key := range m.keys {
		if key.ID != id {
			continue
		}
		if update.IsActive != nil {
			m.keys[i].IsActive = *update.IsActive
		}
		if update.AllowedUserIDs != nil {
			m.keys[i].AllowedUserIDs = *update.AllowedUserIDs
		}
		return &m.keys[i], nil
	}
	return nil, configstore.ErrGlobalAPIKeyNotFound
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

func (m *mockGlobalAPIKeyStore) GetAssignedGlobalAPIKeyToken(_ context.Context, userID, id string) (string, error) {
	for _, key := range m.keys {
		if key.ID != id {
			continue
		}
		if !configstore.IsGlobalAPIKeyAssignedToUser(key, userID) {
			return "", configstore.ErrGlobalAPIKeyNotFound
		}
		token := configstore.DecryptGlobalAPIKeyToken(key.TokenEncrypted)
		if token == "" {
			return "", configstore.ErrGlobalAPIKeyTokenUnavailable
		}
		return token, nil
	}
	return "", configstore.ErrGlobalAPIKeyNotFound
}

func (m *mockGlobalAPIKeyStore) RotateGlobalAPIKeyToken(_ context.Context, id string) (*tables.GlobalAPIKey, string, error) {
	for i, key := range m.keys {
		if key.ID != id {
			continue
		}
		m.keys[i].TokenEncrypted = "bf-ak-rotated-token"
		m.keys[i].TokenPrefix = "bf-ak-rota..."
		return &m.keys[i], "bf-ak-rotated-token", nil
	}
	return nil, "", configstore.ErrGlobalAPIKeyNotFound
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

func TestGlobalAPIKeysListAllowsDashboardSession(t *testing.T) {
	store := &mockGlobalAPIKeyStore{
		authConfig: &configstore.AuthConfig{IsEnabled: true},
		keys:       []tables.GlobalAPIKey{{ID: "key-1", Name: "ci", IsActive: true}},
	}
	handler := &GlobalAPIKeysHandler{configStore: store}
	ctx := &fasthttp.RequestCtx{}
	ctx.SetUserValue(schemas.BifrostContextKeySessionToken, "session-token")
	ctx.Request.Header.SetMethod(fasthttp.MethodGet)
	ctx.Request.SetRequestURI("/api/settings/api-keys")

	handler.list(ctx)
	if ctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", ctx.Response.StatusCode(), fasthttp.StatusOK, string(ctx.Response.Body()))
	}
}

func TestGlobalAPIKeysListRequiresAuthenticationWhenAuthEnabled(t *testing.T) {
	handler := &GlobalAPIKeysHandler{
		configStore: &mockGlobalAPIKeyStore{
			authConfig: &configstore.AuthConfig{IsEnabled: true},
		},
	}
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodGet)
	ctx.Request.SetRequestURI("/api/settings/api-keys")

	handler.list(ctx)
	if ctx.Response.StatusCode() != fasthttp.StatusForbidden {
		t.Fatalf("status = %d, want %d", ctx.Response.StatusCode(), fasthttp.StatusForbidden)
	}
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

func TestGlobalAPIKeysAccessReturnsOnlyAssignedKeys(t *testing.T) {
	store := &mockGlobalAPIKeyStore{
		authConfig: &configstore.AuthConfig{IsEnabled: true},
		keys: []tables.GlobalAPIKey{
			{ID: "key-1", Name: "assigned", IsActive: true, AllowedUserIDs: []string{"user-1"}, TokenEncrypted: "bf-ak-assigned-token", TokenPrefix: "bf-ak-assi..."},
			{ID: "key-2", Name: "other-user", IsActive: true, AllowedUserIDs: []string{"user-2"}},
			{ID: "key-3", Name: "unassigned", IsActive: true},
		},
	}
	handler := &GlobalAPIKeysHandler{configStore: store}
	ctx := newGlobalAPIKeyAccessRequestCtx()

	handler.access(ctx)
	if ctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", ctx.Response.StatusCode(), fasthttp.StatusOK, string(ctx.Response.Body()))
	}

	var payload map[string]any
	if err := json.Unmarshal(ctx.Response.Body(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload["has_access"] != true {
		t.Fatalf("has_access = %v, want true when assigned keys exist", payload["has_access"])
	}
	apiKeys, ok := payload["api_keys"].([]any)
	if !ok || len(apiKeys) != 1 {
		t.Fatalf("api_keys = %#v, want one assigned key", payload["api_keys"])
	}
	firstKey, ok := apiKeys[0].(map[string]any)
	if !ok {
		t.Fatalf("api_keys[0] = %#v, want object", apiKeys[0])
	}
	if firstKey["token"] != "bf-ak-assigned-token" {
		t.Fatalf("token = %v, want full assigned token", firstKey["token"])
	}
}

func TestGlobalAPIKeysAccessReturnsNoAccessWithoutAssignment(t *testing.T) {
	store := &mockGlobalAPIKeyStore{
		authConfig: &configstore.AuthConfig{IsEnabled: true},
		keys: []tables.GlobalAPIKey{
			{ID: "key-1", Name: "other-user", IsActive: true, AllowedUserIDs: []string{"user-2"}},
		},
	}
	handler := &GlobalAPIKeysHandler{configStore: store}
	ctx := newGlobalAPIKeyAccessRequestCtx()

	handler.access(ctx)
	if ctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", ctx.Response.StatusCode(), fasthttp.StatusOK, string(ctx.Response.Body()))
	}

	var payload map[string]any
	if err := json.Unmarshal(ctx.Response.Body(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload["has_access"] != false {
		t.Fatalf("has_access = %v, want false when no assigned keys exist", payload["has_access"])
	}
}

func TestGlobalAPIKeysAccessTokenReturnsAssignedToken(t *testing.T) {
	store := &mockGlobalAPIKeyStore{
		authConfig: &configstore.AuthConfig{IsEnabled: true},
		keys: []tables.GlobalAPIKey{
			{ID: "key-1", Name: "assigned", IsActive: true, AllowedUserIDs: []string{"user-1"}, TokenEncrypted: "bf-ak-assigned-token"},
		},
	}
	handler := &GlobalAPIKeysHandler{configStore: store}
	ctx := newGlobalAPIKeyAccessRequestCtx()
	ctx.SetUserValue("id", "key-1")
	ctx.Request.SetRequestURI("/api/settings/api-keys/access/key-1/token")

	handler.accessToken(ctx)
	if ctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", ctx.Response.StatusCode(), fasthttp.StatusOK, string(ctx.Response.Body()))
	}

	var payload map[string]any
	if err := json.Unmarshal(ctx.Response.Body(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload["token"] != "bf-ak-assigned-token" {
		t.Fatalf("token = %v, want assigned token", payload["token"])
	}
}

func TestGlobalAPIKeysRotateTokenRequiresAdmin(t *testing.T) {
	handler := &GlobalAPIKeysHandler{
		configStore: &mockGlobalAPIKeyStore{
			authConfig: &configstore.AuthConfig{IsEnabled: true},
			keys:       []tables.GlobalAPIKey{{ID: "key-1", Name: "ci", IsActive: true}},
		},
	}
	ctx := &fasthttp.RequestCtx{}
	ctx.SetUserValue("id", "key-1")
	ctx.Request.Header.SetMethod(fasthttp.MethodPost)
	ctx.Request.SetRequestURI("/api/settings/api-keys/key-1/rotate-token")

	handler.rotateToken(ctx)
	if ctx.Response.StatusCode() != fasthttp.StatusForbidden {
		t.Fatalf("status = %d, want %d", ctx.Response.StatusCode(), fasthttp.StatusForbidden)
	}
}

func newGlobalAPIKeyAccessRequestCtx() *fasthttp.RequestCtx {
	ctx := &fasthttp.RequestCtx{}
	ctx.SetUserValue(schemas.BifrostContextKeySessionToken, "session-token")
	ctx.Request.Header.SetMethod(fasthttp.MethodGet)
	ctx.Request.Header.Set("Authorization", "Bearer session-token")
	ctx.Request.SetRequestURI("/api/settings/api-keys/access")
	return ctx
}
