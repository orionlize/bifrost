package governance

import (
	"context"
	"testing"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/stretchr/testify/require"
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

func TestEvaluateGovernanceRequest_GlobalAPIKeyBypassesMandatoryVirtualKey(t *testing.T) {
	const token = configstore.GlobalAPIKeyPrefix + "mandatory-bypass"
	logger := NewMockLogger()
	mockStore := &lookupGlobalAPIKeyStore{
		keys: []configstoreTables.GlobalAPIKey{{
			ID:             "gak-bypass",
			Name:           "assigned-bypass",
			TokenHash:      encrypt.HashSHA256(token),
			IsActive:       true,
			AllowedUserIDs: []string{"user-bypass"},
		}},
	}
	gs, err := NewLocalGovernanceStore(context.Background(), logger, nil, &configstore.GovernanceConfig{}, nil)
	require.NoError(t, err)
	gs.configStore = mockStore
	require.NoError(t, gs.ReloadGlobalAPIKeys(context.Background()))

	plugin, err := InitFromStore(context.Background(), &Config{IsVkMandatory: boolPtr(true)}, logger, gs, nil, nil, nil, nil)
	require.NoError(t, err)
	defer func() {
		require.NoError(t, plugin.Cleanup())
	}()

	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	ctx.SetValue(schemas.BifrostContextKeyRequestHeaders, map[string]string{
		"authorization": token,
	})

	result, bifrostErr := plugin.EvaluateGovernanceRequest(ctx, &EvaluationRequest{
		Provider: schemas.OpenAI,
		Model:    "gpt-4",
	}, schemas.ChatCompletionRequest)
	require.Nil(t, bifrostErr)
	require.NotNil(t, result)
	require.Equal(t, DecisionAllow, result.Decision)
	require.True(t, bifrost.GetBoolFromContext(ctx, schemas.IsLocalAdminContextKey))
	require.Equal(t, "user-bypass", bifrost.GetStringFromContext(ctx, schemas.BifrostContextKeyUserID))
}

func TestEvaluateGovernanceRequest_GlobalAPIKeyFromXAPIKeyBypassesMandatoryVirtualKey(t *testing.T) {
	const token = configstore.GlobalAPIKeyPrefix + "x-api-key-bypass"
	logger := NewMockLogger()
	gs, err := NewLocalGovernanceStore(context.Background(), logger, nil, &configstore.GovernanceConfig{}, nil)
	require.NoError(t, err)

	plugin, err := InitFromStore(context.Background(), &Config{IsVkMandatory: boolPtr(true)}, logger, gs, nil, nil, nil, nil)
	require.NoError(t, err)
	defer func() {
		require.NoError(t, plugin.Cleanup())
	}()

	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	ctx.SetValue(schemas.BifrostContextKeyRequestHeaders, map[string]string{
		"x-api-key": token,
	})

	result, bifrostErr := plugin.EvaluateGovernanceRequest(ctx, &EvaluationRequest{
		Provider: schemas.OpenAI,
		Model:    "gpt-4",
	}, schemas.ChatCompletionRequest)
	require.Nil(t, bifrostErr)
	require.NotNil(t, result)
	require.Equal(t, DecisionAllow, result.Decision)
	require.True(t, bifrost.GetBoolFromContext(ctx, schemas.IsLocalAdminContextKey))
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
