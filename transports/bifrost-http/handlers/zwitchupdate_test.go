package handlers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func initZwitchUpdateRequestCtx(target, arch, currentVersion string) *fasthttp.RequestCtx {
	var req fasthttp.Request
	req.SetRequestURI("/api/aone/zwitch/updates/" + target + "/" + arch + "/" + currentVersion)
	var ctx fasthttp.RequestCtx
	ctx.Init(&req, nil, nil)
	ctx.SetUserValue("target", target)
	ctx.SetUserValue("arch", arch)
	ctx.SetUserValue("current_version", currentVersion)
	return &ctx
}

func TestZwitchUpdateCheckReturns204WhenNoUpdate(t *testing.T) {
	store := setupZwitchUpdateTestStore(t)
	handler := NewZwitchUpdateHandler(store)

	ctx := initZwitchUpdateRequestCtx("darwin", "aarch64", "9.9.9")
	handler.checkUpdate(ctx)
	require.Equal(t, fasthttp.StatusNoContent, ctx.Response.StatusCode())
}

func TestZwitchUpdateCheckReturnsPayload(t *testing.T) {
	store := setupZwitchUpdateTestStore(t)
	require.NoError(t, store.UpdateTauriUpdateConfig(context.Background(), &schemas.TauriUpdateConfig{
		Version: "1.0.0",
		Notes:   "Release",
		PubDate: "2026-06-06T12:00:00Z",
		Platforms: map[string]schemas.TauriUpdatePlatform{
			"darwin-aarch64": {
				URL:       "https://cdn.example.com/zwitch.tar.gz",
				Signature: "minisign-signature",
			},
		},
	}))

	handler := NewZwitchUpdateHandler(store)
	ctx := initZwitchUpdateRequestCtx("darwin", "aarch64", "0.1.0")
	handler.checkUpdate(ctx)

	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode())
	var payload map[string]any
	require.NoError(t, json.Unmarshal(ctx.Response.Body(), &payload))
	require.Equal(t, "1.0.0", payload["version"])
}

func setupZwitchUpdateTestStore(t *testing.T) *configstore.RDBConfigStore {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&tables.TableClientConfig{}))
	store := configstore.NewRDBConfigStoreWithDB(db)
	err = store.UpdateClientConfig(context.Background(), &configstore.ClientConfig{
		EnableLogging:        new(true),
		InitialPoolSize:      100,
		LogRetentionDays:     30,
		MaxRequestBodySizeMB: 50,
	})
	require.NoError(t, err)
	return store
}
