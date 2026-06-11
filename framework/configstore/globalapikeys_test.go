package configstore

import (
	"context"
	"errors"
	"testing"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestToGlobalAPIKeyAccessItemsIncludesDecryptedToken(t *testing.T) {
	keys := []tables.GlobalAPIKey{{
		ID:             "key-1",
		Name:           "ci",
		TokenEncrypted: "bf-ak-full-token-value",
		TokenPrefix:    "bf-ak-full...",
		IsActive:       true,
	}}
	items := ToGlobalAPIKeyAccessItems(keys)
	if len(items) != 1 {
		t.Fatalf("items = %#v", items)
	}
	if items[0].Token != "bf-ak-full-token-value" {
		t.Fatalf("token = %q, want full token when encryption is disabled", items[0].Token)
	}
}

func TestCreateGlobalAPIKeyPersistsRetrievableToken(t *testing.T) {
	encrypt.Init("test-encryption-key-for-testing-32bytes", bifrost.NewDefaultLogger(schemas.LogLevelInfo))

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&tables.GlobalAPIKey{}))

	store := NewRDBConfigStoreWithDB(db)
	ctx := context.Background()

	_, token, err := store.CreateGlobalAPIKey(ctx, "quick-start", []string{"user-1"})
	require.NoError(t, err)
	require.NotEmpty(t, token)

	assigned, err := store.ListAssignedGlobalAPIKeysForUser(ctx, "user-1")
	require.NoError(t, err)
	require.Len(t, assigned, 1)

	items := ToGlobalAPIKeyAccessItems(assigned)
	require.Len(t, items, 1)
	require.Equal(t, token, items[0].Token)

	retrieved, err := store.GetAssignedGlobalAPIKeyToken(ctx, "user-1", assigned[0].ID)
	require.NoError(t, err)
	require.Equal(t, token, retrieved)
}

func TestNormalizeGlobalAPIKeyAllowedUserIDsRejectsMultipleUsers(t *testing.T) {
	_, err := normalizeGlobalAPIKeyAllowedUserIDs([]string{"user-1", "user-2"})
	if !errors.Is(err, ErrGlobalAPIKeyTooManyAssignedUsers) {
		t.Fatalf("err = %v, want %v", err, ErrGlobalAPIKeyTooManyAssignedUsers)
	}
}

func TestGlobalAPIKeyAssignedUserID(t *testing.T) {
	if got := GlobalAPIKeyAssignedUserID(tables.GlobalAPIKey{AllowedUserIDs: []string{" user-1 "}}); got != "user-1" {
		t.Fatalf("assigned user id = %q, want user-1", got)
	}
	if got := GlobalAPIKeyAssignedUserID(tables.GlobalAPIKey{}); got != "" {
		t.Fatalf("expected empty assigned user id, got %q", got)
	}
}

func TestIsGlobalAPIKeyAssignedToUser(t *testing.T) {
	key := tables.GlobalAPIKey{
		ID:             "key-1",
		IsActive:       true,
		AllowedUserIDs: []string{"user-1"},
	}

	if !IsGlobalAPIKeyAssignedToUser(key, "user-1") {
		t.Fatal("expected user-1 to be assigned")
	}
	if IsGlobalAPIKeyAssignedToUser(key, "user-3") {
		t.Fatal("expected user-3 to be unassigned")
	}
	if IsGlobalAPIKeyAssignedToUser(key, "") {
		t.Fatal("expected empty user id to be unassigned")
	}

	inactive := key
	inactive.IsActive = false
	if IsGlobalAPIKeyAssignedToUser(inactive, "user-1") {
		t.Fatal("expected inactive key to be unassigned")
	}

	unassigned := key
	unassigned.AllowedUserIDs = nil
	if IsGlobalAPIKeyAssignedToUser(unassigned, "user-1") {
		t.Fatal("expected key without allowed users to be unassigned")
	}
}
