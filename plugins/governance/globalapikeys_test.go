package governance

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
)

type lookupGlobalAPIKeyStore struct {
	configstore.ConfigStore
	keys []configstoreTables.GlobalAPIKey
}

func (s *lookupGlobalAPIKeyStore) ListGlobalAPIKeys(_ context.Context) ([]configstoreTables.GlobalAPIKey, error) {
	return s.keys, nil
}

func (s *lookupGlobalAPIKeyStore) GetActiveGlobalAPIKeyByToken(_ context.Context, token string) (*configstoreTables.GlobalAPIKey, error) {
	hash := encrypt.HashSHA256(token)
	for i := range s.keys {
		if s.keys[i].TokenHash == hash && s.keys[i].IsActive {
			key := s.keys[i]
			return &key, nil
		}
	}
	return nil, nil
}

func TestLookupGlobalAPIKeyByToken(t *testing.T) {
	const token = configstore.GlobalAPIKeyPrefix + "lookup-test"
	mockStore := &lookupGlobalAPIKeyStore{
		keys: []configstoreTables.GlobalAPIKey{{
			ID:        "gak-lookup",
			Name:      "ops",
			TokenHash: encrypt.HashSHA256(token),
			IsActive:  true,
		}},
	}

	gs := &LocalGovernanceStore{configStore: mockStore}
	if err := gs.ReloadGlobalAPIKeys(context.Background()); err != nil {
		t.Fatalf("reload global api keys: %v", err)
	}

	id, name, assignedUserID, ok := gs.LookupGlobalAPIKeyByToken(context.Background(), token)
	if !ok || id != "gak-lookup" || name != "ops" || assignedUserID != "" {
		t.Fatalf("lookup = (%q, %q, %q, %v), want (gak-lookup, ops, \"\", true)", id, name, assignedUserID, ok)
	}

	if _, _, _, ok := gs.LookupGlobalAPIKeyByToken(context.Background(), configstore.GlobalAPIKeyPrefix+"missing"); ok {
		t.Fatal("expected missing token lookup to fail")
	}
}

func TestLookupGlobalAPIKeyByTokenAssignedUser(t *testing.T) {
	const token = configstore.GlobalAPIKeyPrefix + "assigned-user"
	mockStore := &lookupGlobalAPIKeyStore{
		keys: []configstoreTables.GlobalAPIKey{{
			ID:             "gak-assigned",
			Name:           "assigned",
			TokenHash:      encrypt.HashSHA256(token),
			IsActive:       true,
			AllowedUserIDs: []string{"user-42"},
		}},
	}

	gs := &LocalGovernanceStore{configStore: mockStore}
	if err := gs.ReloadGlobalAPIKeys(context.Background()); err != nil {
		t.Fatalf("reload global api keys: %v", err)
	}

	id, name, assignedUserID, ok := gs.LookupGlobalAPIKeyByToken(context.Background(), token)
	if !ok || id != "gak-assigned" || name != "assigned" || assignedUserID != "user-42" {
		t.Fatalf("lookup = (%q, %q, %q, %v), want (gak-assigned, assigned, user-42, true)", id, name, assignedUserID, ok)
	}
}
