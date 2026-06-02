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

	id, name, ok := gs.LookupGlobalAPIKeyByToken(context.Background(), token)
	if !ok || id != "gak-lookup" || name != "ops" {
		t.Fatalf("lookup = (%q, %q, %v), want (gak-lookup, ops, true)", id, name, ok)
	}

	if _, _, ok := gs.LookupGlobalAPIKeyByToken(context.Background(), configstore.GlobalAPIKeyPrefix+"missing"); ok {
		t.Fatal("expected missing token lookup to fail")
	}
}
