package configstore

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/aoneoauth"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupAoneUserOAuthTokenTestStore(t *testing.T) *RDBConfigStore {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&tables.AoneUserOAuthTokenTable{}))
	s := &RDBConfigStore{logger: nil}
	s.db.Store(db)
	return s
}

func TestUpsertAoneUserOAuthTokenCreatesAndUpdates(t *testing.T) {
	store := setupAoneUserOAuthTokenTestStore(t)
	ctx := context.Background()

	first, err := store.UpsertAoneUserOAuthToken(ctx, "user-1", "zd-switch", &aoneoauth.TokenResponse{
		AccessToken:  "access-1",
		RefreshToken: "refresh-1",
		TokenType:    "Bearer",
		ExpiresIn:    3600,
	})
	require.NoError(t, err)
	require.NotNil(t, first)
	require.Equal(t, "access-1", first.AccessToken)
	require.Equal(t, "refresh-1", first.RefreshToken)
	require.NotNil(t, first.ExpiresAt)

	second, err := store.UpsertAoneUserOAuthToken(ctx, "user-1", "zd-switch", &aoneoauth.TokenResponse{
		AccessToken:  "access-2",
		RefreshToken: "refresh-2",
		TokenType:    "Bearer",
		ExpiresIn:    7200,
	})
	require.NoError(t, err)
	require.Equal(t, first.ID, second.ID)
	require.Equal(t, "access-2", second.AccessToken)
	require.Equal(t, "refresh-2", second.RefreshToken)
	require.True(t, second.ExpiresAt.After(*first.ExpiresAt))

	loaded, err := store.GetAoneUserOAuthToken(ctx, "user-1", "zd-switch")
	require.NoError(t, err)
	require.Equal(t, "access-2", loaded.AccessToken)
}

func TestDeleteAoneUserOAuthTokens(t *testing.T) {
	store := setupAoneUserOAuthTokenTestStore(t)
	ctx := context.Background()

	_, err := store.UpsertAoneUserOAuthToken(ctx, "user-1", "zd-switch", &aoneoauth.TokenResponse{
		AccessToken: "access-1",
		TokenType:   "Bearer",
		ExpiresIn:   int(time.Hour.Seconds()),
	})
	require.NoError(t, err)

	require.NoError(t, store.DeleteAoneUserOAuthTokens(ctx, "user-1"))

	_, err = store.GetAoneUserOAuthToken(ctx, "user-1", "zd-switch")
	require.Error(t, err)
}
