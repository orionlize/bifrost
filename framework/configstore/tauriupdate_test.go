package configstore

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateTauriUpdateConfigRoundTrip(t *testing.T) {
	store := setupRDBTestStore(t)
	ctx := context.Background()

	err := store.UpdateClientConfig(ctx, &ClientConfig{
		EnableLogging:        new(true),
		InitialPoolSize:      100,
		LogRetentionDays:     30,
		MaxRequestBodySizeMB: 50,
	})
	require.NoError(t, err)

	cfg := &schemas.TauriUpdateConfig{
		Version: "0.2.0",
		Notes:   "Bug fixes",
		PubDate: "2026-06-06T12:00:00Z",
		Platforms: map[string]schemas.TauriUpdatePlatform{
			"darwin-aarch64": {
				URL:       "https://cdn.example.com/zwitch-0.2.0-aarch64.app.tar.gz",
				Signature: "sig-aarch64",
			},
		},
	}
	require.NoError(t, store.UpdateTauriUpdateConfig(ctx, cfg))

	loaded, err := store.GetTauriUpdateConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, "0.2.0", loaded.Version)
	require.Equal(t, "Bug fixes", loaded.Notes)
	require.Equal(t, "sig-aarch64", loaded.Platforms["darwin-aarch64"].Signature)
}

func TestBuildTauriUpdateResponse(t *testing.T) {
	cfg := &schemas.TauriUpdateConfig{
		Version: "0.2.0",
		Notes:   "New release",
		PubDate: "2026-06-06T12:00:00Z",
		Platforms: map[string]schemas.TauriUpdatePlatform{
			"darwin-aarch64": {
				URL:       "https://cdn.example.com/zwitch.app.tar.gz",
				Signature: "sig",
			},
		},
	}

	resp, ok := BuildTauriUpdateResponse(cfg, "darwin", "aarch64", "0.1.0")
	require.True(t, ok)
	require.Equal(t, "0.2.0", resp.Version)
	require.Equal(t, "sig", resp.Platforms["darwin-aarch64"].Signature)

	_, ok = BuildTauriUpdateResponse(cfg, "darwin", "aarch64", "0.2.0")
	assert.False(t, ok)

	_, ok = BuildTauriUpdateResponse(cfg, "darwin", "x86_64", "0.1.0")
	assert.False(t, ok)
}

func TestCompareVersions(t *testing.T) {
	assert.True(t, versionLess("0.1.0", "0.2.0"))
	assert.True(t, versionLess("0.9.0", "0.10.0"))
	assert.False(t, versionLess("1.0.0", "0.9.9"))
	assert.False(t, versionLess("v0.2.0", "0.2.0"))
}
