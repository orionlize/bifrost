package configstore

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/aoneoauth"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
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
	require.NoError(t, db.AutoMigrate(&tables.AoneUserOAuthTokenTable{}, &tables.SessionsTable{}))
	s := &RDBConfigStore{logger: nil}
	s.db.Store(db)
	return s
}

func TestUpsertAoneUserOAuthTokenCreatesAndUpdates(t *testing.T) {
	store := setupAoneUserOAuthTokenTestStore(t)
	ctx := context.Background()
	sessionToken := "session-a"

	first, err := store.UpsertAoneUserOAuthToken(ctx, "user-1", "zd-switch", sessionToken, &aoneoauth.TokenResponse{
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

	second, err := store.UpsertAoneUserOAuthToken(ctx, "user-1", "zd-switch", sessionToken, &aoneoauth.TokenResponse{
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

	loaded, err := store.GetAoneUserOAuthToken(ctx, "user-1", "zd-switch", sessionToken)
	require.NoError(t, err)
	require.Equal(t, "access-2", loaded.AccessToken)
}

func TestUpsertAoneUserOAuthTokenMultipleSessions(t *testing.T) {
	store := setupAoneUserOAuthTokenTestStore(t)
	ctx := context.Background()

	_, err := store.UpsertAoneUserOAuthToken(ctx, "user-1", "dashboard", "session-a", &aoneoauth.TokenResponse{
		AccessToken:  "access-a",
		RefreshToken: "refresh-a",
		TokenType:    "Bearer",
		ExpiresIn:    3600,
	})
	require.NoError(t, err)
	_, err = store.UpsertAoneUserOAuthToken(ctx, "user-1", "dashboard", "session-b", &aoneoauth.TokenResponse{
		AccessToken:  "access-b",
		RefreshToken: "refresh-b",
		TokenType:    "Bearer",
		ExpiresIn:    3600,
	})
	require.NoError(t, err)

	rowA, err := store.GetAoneUserOAuthToken(ctx, "user-1", "dashboard", "session-a")
	require.NoError(t, err)
	require.Equal(t, "access-a", rowA.AccessToken)

	rowB, err := store.GetAoneUserOAuthToken(ctx, "user-1", "dashboard", "session-b")
	require.NoError(t, err)
	require.Equal(t, "access-b", rowB.AccessToken)
}

func TestDeleteAoneUserOAuthTokenForSessionLeavesOtherSessions(t *testing.T) {
	store := setupAoneUserOAuthTokenTestStore(t)
	ctx := context.Background()
	now := time.Now()

	require.NoError(t, store.CreateSession(ctx, &tables.SessionsTable{
		Token:       "session-a",
		ExpiresAt:   now.Add(time.Hour),
		LoginSource: "dashboard",
		AoneUserID:  bifrostStrPtr("user-1"),
		CreatedAt:   now,
		UpdatedAt:   now,
	}))
	require.NoError(t, store.CreateSession(ctx, &tables.SessionsTable{
		Token:       "session-b",
		ExpiresAt:   now.Add(time.Hour),
		LoginSource: "dashboard",
		AoneUserID:  bifrostStrPtr("user-1"),
		CreatedAt:   now,
		UpdatedAt:   now,
	}))

	_, err := store.UpsertAoneUserOAuthToken(ctx, "user-1", "dashboard", "session-a", &aoneoauth.TokenResponse{
		AccessToken: "access-a",
		TokenType:   "Bearer",
		ExpiresIn:   3600,
	})
	require.NoError(t, err)
	_, err = store.UpsertAoneUserOAuthToken(ctx, "user-1", "dashboard", "session-b", &aoneoauth.TokenResponse{
		AccessToken: "access-b",
		TokenType:   "Bearer",
		ExpiresIn:   3600,
	})
	require.NoError(t, err)

	require.NoError(t, store.DeleteAoneUserOAuthTokenForSession(ctx, "user-1", "dashboard", "session-a"))
	require.NoError(t, store.DeleteSession(ctx, "session-a"))

	_, err = store.GetAoneUserOAuthToken(ctx, "user-1", "dashboard", "session-a")
	require.Error(t, err)

	rowB, err := store.GetAoneUserOAuthToken(ctx, "user-1", "dashboard", "session-b")
	require.NoError(t, err)
	require.Equal(t, "access-b", rowB.AccessToken)
}

func TestDeleteAoneUserOAuthTokens(t *testing.T) {
	store := setupAoneUserOAuthTokenTestStore(t)
	ctx := context.Background()

	_, err := store.UpsertAoneUserOAuthToken(ctx, "user-1", "zd-switch", "session-a", &aoneoauth.TokenResponse{
		AccessToken: "access-1",
		TokenType:   "Bearer",
		ExpiresIn:   int(time.Hour.Seconds()),
	})
	require.NoError(t, err)

	require.NoError(t, store.DeleteAoneUserOAuthTokens(ctx, "user-1"))

	_, err = store.GetAoneUserOAuthToken(ctx, "user-1", "zd-switch", "session-a")
	require.Error(t, err)
}

func TestCountActiveAoneUserSessionsExcludesCurrent(t *testing.T) {
	store := setupAoneUserOAuthTokenTestStore(t)
	ctx := context.Background()
	now := time.Now()

	require.NoError(t, store.CreateSession(ctx, &tables.SessionsTable{
		Token:      "session-a",
		TokenHash:  encrypt.HashSHA256("session-a"),
		ExpiresAt:  now.Add(time.Hour),
		AoneUserID: bifrostStrPtr("user-1"),
		CreatedAt:  now,
		UpdatedAt:  now,
	}))
	require.NoError(t, store.CreateSession(ctx, &tables.SessionsTable{
		Token:      "session-b",
		TokenHash:  encrypt.HashSHA256("session-b"),
		ExpiresAt:  now.Add(time.Hour),
		AoneUserID: bifrostStrPtr("user-1"),
		CreatedAt:  now,
		UpdatedAt:  now,
	}))

	count, err := store.CountActiveAoneUserSessions(ctx, "user-1", "", "session-a")
	require.NoError(t, err)
	require.Equal(t, int64(1), count)
}

func bifrostStrPtr(s string) *string {
	return &s
}
