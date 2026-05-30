package configstore

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupDeviceCredentialStore(t *testing.T) *RDBConfigStore {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&tables.AoneDeviceCredentialTable{}))
	s := &RDBConfigStore{}
	s.db.Store(db)
	return s
}

func TestCreateAndResolveDeviceCredential(t *testing.T) {
	store := setupDeviceCredentialStore(t)
	ctx := context.Background()

	token, expiresAt, err := store.CreateAoneDeviceTemporaryCredential(ctx, "user-1", 7, "fp-1", "vk-1", DefaultAoneDeviceCredentialTTL)
	require.NoError(t, err)
	require.NotEmpty(t, token)
	require.WithinDuration(t, time.Now().Add(24*time.Hour), expiresAt, time.Minute)

	row, err := store.ResolveActiveAoneDeviceTemporaryCredential(ctx, token)
	require.NoError(t, err)
	require.Equal(t, "user-1", row.AoneUserID)
	require.Equal(t, 7, row.DeviceAuthorizationID)
	require.Equal(t, "fp-1", row.DeviceFingerprint)
	require.Equal(t, "vk-1", row.VirtualKeyID)

	// Unknown token does not resolve.
	_, err = store.ResolveActiveAoneDeviceTemporaryCredential(ctx, "bf-tmp-unknown")
	require.ErrorIs(t, err, ErrDeviceCredentialNotFound)
}

func TestDeviceCredentialExpiry(t *testing.T) {
	store := setupDeviceCredentialStore(t)
	ctx := context.Background()

	token, _, err := store.CreateAoneDeviceTemporaryCredential(ctx, "user-1", 1, "fp-1", "vk-1", DefaultAoneDeviceCredentialTTL)
	require.NoError(t, err)

	// Backdate the credential so it is past its expiry.
	require.NoError(t, store.DB().WithContext(ctx).
		Model(&tables.AoneDeviceCredentialTable{}).
		Where("device_authorization_id = ?", 1).
		Update("expires_at", time.Now().Add(-time.Minute)).Error)

	_, err = store.ResolveActiveAoneDeviceTemporaryCredential(ctx, token)
	require.ErrorIs(t, err, ErrDeviceCredentialExpired)
}

func TestNewCredentialRevokesPriorForDevice(t *testing.T) {
	store := setupDeviceCredentialStore(t)
	ctx := context.Background()

	first, _, err := store.CreateAoneDeviceTemporaryCredential(ctx, "user-1", 9, "fp-1", "vk-1", DefaultAoneDeviceCredentialTTL)
	require.NoError(t, err)
	second, _, err := store.CreateAoneDeviceTemporaryCredential(ctx, "user-1", 9, "fp-1", "vk-1", DefaultAoneDeviceCredentialTTL)
	require.NoError(t, err)

	_, err = store.ResolveActiveAoneDeviceTemporaryCredential(ctx, first)
	require.ErrorIs(t, err, ErrDeviceCredentialNotFound)
	_, err = store.ResolveActiveAoneDeviceTemporaryCredential(ctx, second)
	require.NoError(t, err)
}

func TestRevokeDeviceCredentialsForUser(t *testing.T) {
	store := setupDeviceCredentialStore(t)
	ctx := context.Background()

	token, _, err := store.CreateAoneDeviceTemporaryCredential(ctx, "user-1", 3, "fp-1", "vk-1", DefaultAoneDeviceCredentialTTL)
	require.NoError(t, err)

	require.NoError(t, store.RevokeAoneDeviceTemporaryCredentialsForUser(ctx, "user-1"))
	_, err = store.ResolveActiveAoneDeviceTemporaryCredential(ctx, token)
	require.ErrorIs(t, err, ErrDeviceCredentialNotFound)
}
