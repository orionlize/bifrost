package handlers

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestGetCurrentUserWithDeviceCredential(t *testing.T) {
	store := setupAoneDevicesHandlerStore(t)
	ctx := context.Background()
	aoneID := "aone-user-me"
	vkID := "vk-aone-user-me"
	vkValue := "sk-bf-me-test"
	isActive := true
	require.NoError(t, store.CreateVirtualKey(ctx, &tables.TableVirtualKey{
		ID:              vkID,
		Name:            "me-test-key",
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

	code, err := store.UpsertAoneDeviceAuthorization(ctx, aoneID, "fp-me", "zwitch")
	require.NoError(t, err)
	device, err := store.GetActiveAoneDeviceAuthorizationByCode(ctx, code)
	require.NoError(t, err)

	credential, _, err := store.CreateAoneDeviceTemporaryCredential(
		ctx,
		aoneID,
		device.ID,
		"fp-me",
		vkID,
		configstore.DefaultAoneDeviceCredentialTTL,
	)
	require.NoError(t, err)

	handler := NewAoneUsersHandler(store, nil)
	reqCtx := initGateDeviceRequestCtx()
	reqCtx.Request.Header.SetMethod(fasthttp.MethodGet)
	reqCtx.Request.SetRequestURI("/api/aone/users/me")
	reqCtx.Request.Header.Set("Authorization", "Bearer "+credential)

	handler.getCurrentUser(reqCtx)
	require.Equal(t, fasthttp.StatusOK, reqCtx.Response.StatusCode())

	var resp map[string]any
	require.NoError(t, json.Unmarshal(reqCtx.Response.Body(), &resp))
	require.Equal(t, vkValue, resp["api_key"])
	user, ok := resp["user"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, aoneID, user["id"])
}

func TestGetCurrentUserWithSessionToken(t *testing.T) {
	store := setupAoneDevicesHandlerStore(t)
	ctx := context.Background()
	aoneID := "aone-user-session-me"
	vkID := "vk-aone-user-session-me"
	vkValue := "sk-bf-session-me"
	isActive := true
	require.NoError(t, store.CreateVirtualKey(ctx, &tables.TableVirtualKey{
		ID:              vkID,
		Name:            "session-me-key",
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

	sessionToken := "session-me-token"
	require.NoError(t, store.DB().WithContext(ctx).Create(&tables.SessionsTable{
		Token:       sessionToken,
		ExpiresAt:   time.Now().Add(time.Hour),
		AoneUserID:  &aoneID,
		LoginSource: loginSourceDashboard,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}).Error)

	handler := NewAoneUsersHandler(store, nil)
	reqCtx := initGateDeviceRequestCtx()
	reqCtx.Request.Header.SetMethod(fasthttp.MethodGet)
	reqCtx.Request.SetRequestURI("/api/aone/users/me")
	reqCtx.Request.Header.SetCookie("token", sessionToken)

	handler.getCurrentUser(reqCtx)
	require.Equal(t, fasthttp.StatusOK, reqCtx.Response.StatusCode())

	var resp map[string]any
	require.NoError(t, json.Unmarshal(reqCtx.Response.Body(), &resp))
	require.Equal(t, vkValue, resp["api_key"])
}

func TestGetCurrentUserRejectsUnknownToken(t *testing.T) {
	store := setupAoneDevicesHandlerStore(t)
	handler := NewAoneUsersHandler(store, nil)
	reqCtx := initGateDeviceRequestCtx()
	reqCtx.Request.Header.SetMethod(fasthttp.MethodGet)
	reqCtx.Request.SetRequestURI("/api/aone/users/me")
	reqCtx.Request.Header.Set("Authorization", "Bearer unknown-token")

	handler.getCurrentUser(reqCtx)
	require.Equal(t, fasthttp.StatusUnauthorized, reqCtx.Response.StatusCode())
}
