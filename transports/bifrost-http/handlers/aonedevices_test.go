package handlers

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupAoneDevicesHandlerStore(t *testing.T) *configstore.RDBConfigStore {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&tables.AoneDeviceAuthorizationTable{},
		&tables.AoneDeviceCredentialTable{},
		&tables.SessionsTable{},
		&tables.AoneUserTable{},
		&tables.TableProvider{},
		&tables.TableMCPClient{},
		&tables.TableVirtualKey{},
		&tables.TableVirtualKeyProviderConfig{},
		&tables.TableVirtualKeyProviderConfigKey{},
		&tables.TableVirtualKeyMCPConfig{},
		&tables.GlobalAPIKey{},
	))
	return configstore.NewRDBConfigStoreWithDB(db)
}

func initGateDeviceRequestCtx() *fasthttp.RequestCtx {
	var req fasthttp.Request
	req.Header.SetMethod(fasthttp.MethodPost)
	req.SetRequestURI("/v1/chat/completions")
	var reqCtx fasthttp.RequestCtx
	reqCtx.Init(&req, nil, nil)
	return &reqCtx
}

func TestAoneDevicesAuthorizeAndToken(t *testing.T) {
	store := setupAoneDevicesHandlerStore(t)
	ctx := context.Background()
	aoneID := "aone-user-1"
	vkID := "vk-aone-user-1"
	require.NoError(t, store.DB().WithContext(ctx).Create(&tables.AoneUserTable{
		AoneUserID:   aoneID,
		VirtualKeyID: &vkID,
		LastLoginAt:  time.Now(),
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}).Error)

	sessionToken := "desktop-bootstrap-token"
	require.NoError(t, store.DB().WithContext(ctx).Create(&tables.SessionsTable{
		Token:       sessionToken,
		ExpiresAt:   time.Now().Add(time.Hour),
		AoneUserID:  &aoneID,
		LoginSource: loginSourceZdSwitch,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}).Error)

	handler := NewAoneDevicesHandler(store, nil)

	authorizeCtx := &fasthttp.RequestCtx{}
	authorizeCtx.Request.Header.SetMethod(fasthttp.MethodPost)
	authorizeCtx.Request.SetRequestURI("/api/aone/devices/authorize")
	authorizeCtx.Request.Header.Set("Authorization", "Bearer "+sessionToken)
	authorizeCtx.Request.SetBodyString(`{"device_fingerprint":"macos-aarch64-abc","device_name":"zd-switch"}`)
	handler.authorize(authorizeCtx)
	require.Equal(t, fasthttp.StatusOK, authorizeCtx.Response.StatusCode())

	var authorizeResp map[string]string
	require.NoError(t, json.Unmarshal(authorizeCtx.Response.Body(), &authorizeResp))
	code := authorizeResp["authorization_code"]
	require.NotEmpty(t, code)

	tokenCtx := &fasthttp.RequestCtx{}
	tokenCtx.Request.Header.SetMethod(fasthttp.MethodPost)
	tokenCtx.Request.SetRequestURI("/api/aone/devices/token")
	tokenCtx.Request.Header.SetHost("localhost:8080")
	tokenBody, _ := json.Marshal(map[string]string{
		"authorization_code": code,
		"device_fingerprint": "macos-aarch64-abc",
	})
	tokenCtx.Request.SetBody(tokenBody)
	handler.token(tokenCtx)
	require.Equal(t, fasthttp.StatusOK, tokenCtx.Response.StatusCode())

	var tokenResp map[string]any
	require.NoError(t, json.Unmarshal(tokenCtx.Response.Body(), &tokenResp))
	credential, _ := tokenResp["credential"].(string)
	require.NotEmpty(t, credential)
	require.True(t, strings.HasPrefix(credential, configstore.AoneDeviceCredentialPrefix))
	require.Equal(t, credential, tokenResp["access_token"])
	require.Equal(t, "http://localhost:8080", tokenResp["base_url"])

	// The issued credential resolves to an active, unexpired row.
	resolved, err := store.ResolveActiveAoneDeviceTemporaryCredential(ctx, credential)
	require.NoError(t, err)
	require.Equal(t, aoneID, resolved.AoneUserID)
	require.Equal(t, "macos-aarch64-abc", resolved.DeviceFingerprint)

	revokeCtx := &fasthttp.RequestCtx{}
	revokeCtx.Request.Header.SetMethod(fasthttp.MethodPost)
	revokeCtx.Request.SetRequestURI("/api/aone/devices/revoke")
	revokeBody, _ := json.Marshal(map[string]string{
		"authorization_code": code,
		"device_fingerprint": "macos-aarch64-abc",
	})
	revokeCtx.Request.SetBody(revokeBody)
	handler.revoke(revokeCtx)
	require.Equal(t, fasthttp.StatusOK, revokeCtx.Response.StatusCode())

	// Revoking the device authorization also revokes its live credential.
	_, resolveErr := store.ResolveActiveAoneDeviceTemporaryCredential(ctx, credential)
	require.ErrorIs(t, resolveErr, configstore.ErrDeviceCredentialNotFound)

	tokenCtx2 := &fasthttp.RequestCtx{}
	tokenCtx2.Request.Header.SetMethod(fasthttp.MethodPost)
	tokenCtx2.Request.SetRequestURI("/api/aone/devices/token")
	tokenCtx2.Request.SetBody(tokenBody)
	handler.token(tokenCtx2)
	require.Equal(t, fasthttp.StatusUnauthorized, tokenCtx2.Response.StatusCode())
}

func TestAoneDevicesAuthorizeUnauthorizedWithoutSession(t *testing.T) {
	store := setupAoneDevicesHandlerStore(t)
	handler := NewAoneDevicesHandler(store, nil)
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodPost)
	ctx.Request.SetBodyString(`{"device_fingerprint":"fp","device_name":"x"}`)
	handler.authorize(ctx)
	require.Equal(t, fasthttp.StatusUnauthorized, ctx.Response.StatusCode())
}

func TestAoneDevicesTokenFingerprintMismatch(t *testing.T) {
	store := setupAoneDevicesHandlerStore(t)
	ctx := context.Background()

	code, err := store.UpsertAoneDeviceAuthorization(ctx, "user-1", "fp-real", "device")
	require.NoError(t, err)
	require.NoError(t, store.DB().WithContext(ctx).Create(&tables.AoneUserTable{
		AoneUserID:  "user-1",
		LastLoginAt: time.Now(),
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}).Error)

	handler := NewAoneDevicesHandler(store, nil)
	tokenCtx := &fasthttp.RequestCtx{}
	tokenCtx.Request.Header.SetMethod(fasthttp.MethodPost)
	tokenBody, _ := json.Marshal(map[string]string{
		"authorization_code": code,
		"device_fingerprint": "fp-wrong",
	})
	tokenCtx.Request.SetBody(tokenBody)
	handler.token(tokenCtx)
	require.Equal(t, fasthttp.StatusForbidden, tokenCtx.Response.StatusCode())
}

func setupGateDeviceTestFixtures(t *testing.T, store *configstore.RDBConfigStore) (aoneID, vkValue, sessionToken string) {
	t.Helper()
	ctx := context.Background()
	aoneID = "aone-user-gate"
	vkID := "vk-aone-user-gate"
	vkValue = "sk-bf-gate-test"
	isActive := true
	require.NoError(t, store.CreateVirtualKey(ctx, &tables.TableVirtualKey{
		ID:              vkID,
		Name:            "gate-test-key",
		Value:           vkValue,
		IsActive:        &isActive,
		CreatedByUserID: &aoneID,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}))
	require.NoError(t, store.DB().WithContext(ctx).Create(&tables.AoneUserTable{
		AoneUserID:   aoneID,
		VirtualKeyID: &vkID,
		LastLoginAt:  time.Now(),
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}).Error)
	sessionToken = "gate-session-token"
	return aoneID, vkValue, sessionToken
}

func TestGateDeviceOnForwarding_WebSessionBypassesFingerprint(t *testing.T) {
	store := setupAoneDevicesHandlerStore(t)
	aoneID, vkValue, sessionToken := setupGateDeviceTestFixtures(t, store)
	ctx := context.Background()
	require.NoError(t, store.DB().WithContext(ctx).Create(&tables.SessionsTable{
		Token:       sessionToken,
		ExpiresAt:   time.Now().Add(time.Hour),
		AoneUserID:  &aoneID,
		LoginSource: loginSourceDashboard,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}).Error)

	am := &AuthMiddleware{store: store}
	SetLogger(&mockLogger{})

	reqCtx := initGateDeviceRequestCtx()
	reqCtx.Request.Header.Set("Authorization", "Bearer "+vkValue)
	reqCtx.Request.Header.SetCookie("token", sessionToken)

	require.True(t, am.gateDeviceOnForwarding(reqCtx, "/v1/chat/completions"))
}

func TestGateDeviceOnForwarding_DeviceSessionRequiresFingerprint(t *testing.T) {
	store := setupAoneDevicesHandlerStore(t)
	aoneID, vkValue, sessionToken := setupGateDeviceTestFixtures(t, store)
	ctx := context.Background()
	_, err := store.UpsertAoneDeviceAuthorization(ctx, aoneID, "fp-device", "zd-switch")
	require.NoError(t, err)
	device, err := store.GetActiveAoneDeviceAuthorizationForUsers(ctx, []string{aoneID}, "fp-device")
	require.NoError(t, err)
	deviceID := device.ID

	require.NoError(t, store.DB().WithContext(ctx).Create(&tables.SessionsTable{
		Token:                 sessionToken,
		ExpiresAt:             time.Now().Add(time.Hour),
		AoneUserID:            &aoneID,
		LoginSource:           loginSourceZdSwitch,
		DeviceAuthorizationID: &deviceID,
		CreatedAt:             time.Now(),
		UpdatedAt:             time.Now(),
	}).Error)

	am := &AuthMiddleware{store: store}
	SetLogger(&mockLogger{})

	reqCtx := initGateDeviceRequestCtx()
	reqCtx.Request.Header.Set("Authorization", "Bearer "+vkValue)
	reqCtx.Request.Header.SetCookie("token", sessionToken)

	require.False(t, am.gateDeviceOnForwarding(reqCtx, "/v1/chat/completions"))
	require.Equal(t, fasthttp.StatusUnauthorized, reqCtx.Response.StatusCode())
	require.Contains(t, string(reqCtx.Response.Body()), "missing device fingerprint")
}

func TestGateDeviceOnForwarding_SkBfWithoutSessionRequiresFingerprint(t *testing.T) {
	store := setupAoneDevicesHandlerStore(t)
	_, vkValue, _ := setupGateDeviceTestFixtures(t, store)

	am := &AuthMiddleware{store: store}
	SetLogger(&mockLogger{})

	reqCtx := initGateDeviceRequestCtx()
	reqCtx.Request.Header.Set("Authorization", "Bearer "+vkValue)

	require.False(t, am.gateDeviceOnForwarding(reqCtx, "/v1/chat/completions"))
	require.Equal(t, fasthttp.StatusUnauthorized, reqCtx.Response.StatusCode())
	require.Contains(t, string(reqCtx.Response.Body()), "missing device fingerprint")
}
