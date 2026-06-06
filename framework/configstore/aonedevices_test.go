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

func setupAoneDeviceAuthTestStore(t *testing.T) *RDBConfigStore {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&tables.AoneDeviceAuthorizationTable{},
		&tables.SessionsTable{},
		&tables.AoneUserTable{},
	))
	s := &RDBConfigStore{logger: nil}
	s.db.Store(db)
	return s
}

func TestUpsertAoneDeviceAuthorizationIdempotentPerDevice(t *testing.T) {
	store := setupAoneDeviceAuthTestStore(t)
	ctx := context.Background()

	code1, err := store.UpsertAoneDeviceAuthorization(ctx, "user-1", "fp-abc", "macbook")
	require.NoError(t, err)
	require.NotEmpty(t, code1)

	code2, err := store.UpsertAoneDeviceAuthorization(ctx, "user-1", "fp-abc", "macbook-pro")
	require.NoError(t, err)
	require.NotEmpty(t, code2)
	require.NotEqual(t, code1, code2)

	row, err := store.GetActiveAoneDeviceAuthorizationByCode(ctx, code2)
	require.NoError(t, err)
	require.Equal(t, "macbook-pro", row.DeviceName)
	require.Equal(t, "fp-abc", row.DeviceFingerprint)

	_, err = store.GetActiveAoneDeviceAuthorizationByCode(ctx, code1)
	require.ErrorIs(t, err, ErrDeviceAuthorizationNotFound)
}

func TestDeviceAuthorizationTokenFlow(t *testing.T) {
	store := setupAoneDeviceAuthTestStore(t)
	ctx := context.Background()

	code, err := store.UpsertAoneDeviceAuthorization(ctx, "user-1", "fp-1", "zwitch")
	require.NoError(t, err)

	token, err := store.CreateAoneUserDeviceAccessSession(ctx, "user-1", "zwitch", nil, time.Now().Add(time.Hour))
	require.NoError(t, err)
	require.NotEmpty(t, token)

	require.NoError(t, store.RevokeAoneDeviceAuthorization(ctx, code, "fp-1"))
	_, err = store.GetActiveAoneDeviceAuthorizationByCode(ctx, code)
	require.ErrorIs(t, err, ErrDeviceAuthorizationRevoked)

	require.NoError(t, store.RevokeAllAoneDeviceAuthorizationsForUser(ctx, "user-1"))
}

func TestGetAoneDeviceAuthorizationsPaginated(t *testing.T) {
	store := setupAoneDeviceAuthTestStore(t)
	ctx := context.Background()

	require.NoError(t, store.DB().WithContext(ctx).Create(&tables.AoneUserTable{
		AoneUserID:  "user-1",
		Email:       "alice@example.com",
		DisplayName: "Alice",
		LastLoginAt: time.Now(),
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}).Error)

	accessTime := time.Now().Add(-time.Hour)
	require.NoError(t, store.DB().WithContext(ctx).Create(&tables.AoneDeviceAuthorizationTable{
		AuthorizationCode: "advc_test_1",
		DeviceFingerprint: "fp-abc",
		AoneUserID:        "user-1",
		DeviceName:        "macbook",
		Status:            tables.AoneDeviceAuthorizationStatusActive,
		LastAPIAccessAt:   &accessTime,
		CreatedAt:         time.Now(),
		UpdatedAt:         time.Now(),
	}).Error)

	rows, total, err := store.GetAoneDeviceAuthorizationsPaginated(ctx, AoneDeviceAuthorizationsQueryParams{
		Limit:  25,
		Offset: 0,
		Search: "fp-abc",
	})
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, rows, 1)
	require.Equal(t, "Alice", rows[0].UserDisplayName)
	require.Equal(t, "alice@example.com", rows[0].UserEmail)
}

func TestSetAoneDeviceAuthorizationStatus(t *testing.T) {
	store := setupAoneDeviceAuthTestStore(t)
	ctx := context.Background()

	code, err := store.UpsertAoneDeviceAuthorization(ctx, "user-1", "fp-1", "device")
	require.NoError(t, err)
	row, err := store.GetActiveAoneDeviceAuthorizationByCode(ctx, code)
	require.NoError(t, err)

	disabled, err := store.SetAoneDeviceAuthorizationStatus(ctx, row.ID, false)
	require.NoError(t, err)
	require.Equal(t, tables.AoneDeviceAuthorizationStatusRevoked, disabled.Status)

	enabled, err := store.SetAoneDeviceAuthorizationStatus(ctx, row.ID, true)
	require.NoError(t, err)
	require.Equal(t, tables.AoneDeviceAuthorizationStatusActive, enabled.Status)
}

func TestRevokeAoneDeviceAuthorizationFingerprintMismatch(t *testing.T) {
	store := setupAoneDeviceAuthTestStore(t)
	ctx := context.Background()

	code, err := store.UpsertAoneDeviceAuthorization(ctx, "user-1", "fp-1", "device")
	require.NoError(t, err)

	err = store.RevokeAoneDeviceAuthorization(ctx, code, "wrong-fp")
	require.ErrorIs(t, err, ErrDeviceFingerprintMismatch)

	row, err := store.GetActiveAoneDeviceAuthorizationByCode(ctx, code)
	require.NoError(t, err)
	require.Equal(t, tables.AoneDeviceAuthorizationStatusActive, row.Status)
}
