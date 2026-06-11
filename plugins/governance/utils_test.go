package governance

import (
	"context"
	"testing"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/modelcatalog"
	"github.com/stretchr/testify/require"
)

func TestParseGlobalAPIKeyBearerToken(t *testing.T) {
	req := schemas.AcquireHTTPRequest()
	defer schemas.ReleaseHTTPRequest(req)

	req.Headers["Authorization"] = "Bearer " + configstore.GlobalAPIKeyPrefix + "abcd"
	if got := parseGlobalAPIKeyBearerToken(req); got != configstore.GlobalAPIKeyPrefix+"abcd" {
		t.Fatalf("token = %q, want %q", got, configstore.GlobalAPIKeyPrefix+"abcd")
	}

	req.Headers["Authorization"] = "Bearer sk-bf-vk"
	if got := parseGlobalAPIKeyBearerToken(req); got != "" {
		t.Fatalf("virtual key token = %q, want empty", got)
	}
}

func TestResolveProviderForRouting(t *testing.T) {
	mc := modelcatalog.NewTestCatalog(map[string]string{
		"claude-mythos-preview": "claude-mythos-preview",
	})
	mc.UpsertModelDataForProvider(schemas.Anthropic, &schemas.BifrostListModelsResponse{
		Data: []schemas.Model{{ID: "anthropic/claude-mythos-preview"}},
	}, nil)

	plugin := &GovernancePlugin{
		modelCatalog: mc,
		inMemoryStore: &mockInMemoryStore{
			configuredProviders: map[schemas.ModelProvider]configstore.ProviderConfig{
				schemas.Anthropic: {},
			},
		},
	}

	got := plugin.resolveProviderForRouting("claude-mythos-preview", nil)
	require.Equal(t, schemas.Anthropic, got)

	vk := buildVirtualKeyWithProviders("vk1", "sk-bf-test", "anthropic-only", []configstoreTables.TableVirtualKeyProviderConfig{
		buildProviderConfig("anthropic", []string{"*"}),
	})
	got = plugin.resolveProviderForRouting("claude-mythos-preview", vk)
	require.Equal(t, schemas.Anthropic, got)
}

func TestProviderHasKeysSupportingModel(t *testing.T) {
	store := &mockInMemoryStore{
		configuredProviders: map[schemas.ModelProvider]configstore.ProviderConfig{
			schemas.Anthropic: {
				Keys: []schemas.Key{{
					ID:     "anthropic-key",
					Name:   "anthropic-key",
					Value:  *schemas.NewEnvVar("sk-anthropic"),
					Models: []string{"claude-mythos-preview"},
				}},
			},
			schemas.OpenAI: {
				Keys: []schemas.Key{{
					ID:     "openai-key",
					Name:   "openai-key",
					Value:  *schemas.NewEnvVar("sk-openai"),
					Models: []string{"gpt-4o"},
				}},
			},
		},
	}

	vkPC := buildProviderConfig("anthropic", []string{"*"})
	vkPC.AllowAllKeys = true
	require.True(t, providerHasKeysSupportingModel(store, schemas.Anthropic, "claude-mythos-preview-fast", vkPC, "user-a", false))
	openaiPC := buildProviderConfig("openai", []string{"*"})
	openaiPC.AllowAllKeys = true
	require.False(t, providerHasKeysSupportingModel(store, schemas.OpenAI, "claude-mythos-preview-fast", openaiPC, "user-a", false))
}

func TestProviderHasKeysSupportingModel_Grayscale(t *testing.T) {
	grayscaleOn := true
	store := &mockInMemoryStore{
		configuredProviders: map[schemas.ModelProvider]configstore.ProviderConfig{
			schemas.Anthropic: {
				Keys: []schemas.Key{
					{
						ID:               "gray-key",
						Name:             "gray-key",
						Value:            *schemas.NewEnvVar("sk-gray"),
						Models:           []string{"claude-mythos-preview-fast"},
						GrayscaleEnabled: &grayscaleOn,
						GrayscaleUsers:   []string{"user-a"},
					},
					{
						ID:     "open-key",
						Name:   "open-key",
						Value:  *schemas.NewEnvVar("sk-open"),
						Models: []string{"claude-mythos-preview-fast"},
					},
				},
			},
		},
	}
	vkPC := buildProviderConfig("anthropic", []string{"*"})
	vkPC.AllowAllKeys = true

	require.True(t, providerHasKeysSupportingModel(store, schemas.Anthropic, "claude-mythos-preview-fast", vkPC, "user-a", false))
	require.True(t, providerHasKeysSupportingModel(store, schemas.Anthropic, "claude-mythos-preview-fast", vkPC, "user-b", false))

	onlyGrayStore := &mockInMemoryStore{
		configuredProviders: map[schemas.ModelProvider]configstore.ProviderConfig{
			schemas.Anthropic: {
				Keys: []schemas.Key{{
					ID:               "gray-key",
					Name:             "gray-key",
					Value:            *schemas.NewEnvVar("sk-gray"),
					Models:           []string{"claude-mythos-preview-fast"},
					GrayscaleEnabled: &grayscaleOn,
					GrayscaleUsers:   []string{"user-a"},
				}},
			},
		},
	}
	require.True(t, providerHasKeysSupportingModel(onlyGrayStore, schemas.Anthropic, "claude-mythos-preview-fast", vkPC, "user-a", false))
	require.False(t, providerHasKeysSupportingModel(onlyGrayStore, schemas.Anthropic, "claude-mythos-preview-fast", vkPC, "user-b", false))
}

func TestEnsureProviderWithAccessibleKeys_GrayscaleReroute(t *testing.T) {
	logger := NewMockLogger()
	grayscaleOn := true
	mc := modelcatalog.NewTestCatalog(map[string]string{
		"claude-mythos-preview-fast": "claude-mythos-preview-fast",
	})
	mc.UpsertModelDataForProvider(schemas.Anthropic, &schemas.BifrostListModelsResponse{
		Data: []schemas.Model{{ID: "anthropic/claude-mythos-preview-fast"}},
	}, nil)
	mc.UpsertModelDataForProvider(schemas.Bedrock, &schemas.BifrostListModelsResponse{
		Data: []schemas.Model{{ID: "bedrock/claude-mythos-preview-fast"}},
	}, nil)

	vk := buildVirtualKeyWithProviders(
		"vk-gray-reroute",
		"sk-bf-gray-reroute",
		"gray-reroute-vk",
		[]configstoreTables.TableVirtualKeyProviderConfig{
			func() configstoreTables.TableVirtualKeyProviderConfig {
				pc := buildProviderConfig("anthropic", []string{"*"})
				pc.AllowAllKeys = true
				return pc
			}(),
			func() configstoreTables.TableVirtualKeyProviderConfig {
				pc := buildProviderConfig("bedrock", []string{"*"})
				pc.AllowAllKeys = true
				return pc
			}(),
		},
	)

	store, err := NewLocalGovernanceStore(context.Background(), logger, nil, &configstore.GovernanceConfig{
		VirtualKeys: []configstoreTables.TableVirtualKey{*vk},
	}, mc)
	require.NoError(t, err)

	inMemoryStore := &mockInMemoryStore{
		configuredProviders: map[schemas.ModelProvider]configstore.ProviderConfig{
			schemas.Anthropic: {
				Keys: []schemas.Key{{
					ID:               "anthropic-gray",
					Name:             "anthropic-gray",
					Value:            *schemas.NewEnvVar("sk-anthropic"),
					Models:           []string{"claude-mythos-preview-fast"},
					GrayscaleEnabled: &grayscaleOn,
					GrayscaleUsers:   []string{"user-a"},
				}},
			},
			schemas.Bedrock: {
				Keys: []schemas.Key{{
					ID:               "bedrock-gray",
					Name:             "bedrock-gray",
					Value:            *schemas.NewEnvVar("sk-bedrock"),
					Models:           []string{"claude-mythos-preview-fast"},
					GrayscaleEnabled: &grayscaleOn,
					GrayscaleUsers:   []string{"user-b"},
				}},
			},
		},
	}

	plugin, err := InitFromStore(context.Background(), &Config{IsVkMandatory: boolPtr(false)}, logger, store, nil, mc, nil, inMemoryStore)
	require.NoError(t, err)
	defer func() {
		require.NoError(t, plugin.Cleanup())
	}()

	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	ctx.SetValue(schemas.BifrostContextKeyUserID, "user-b")
	ctx.SetValue(schemas.BifrostContextKeyVirtualKey, vk.Value)

	req := &schemas.BifrostRequest{
		RequestType: schemas.ChatCompletionRequest,
		ChatRequest: &schemas.BifrostChatRequest{
			Provider: schemas.Anthropic,
			Model:    "claude-mythos-preview-fast",
		},
	}

	plugin.ensureProviderWithAccessibleKeys(ctx, req, vk.Value)
	require.Equal(t, schemas.Bedrock, req.ChatRequest.Provider)

	logs := ctx.GetRoutingEngineLogs()
	require.NotEmpty(t, logs)
	require.Contains(t, logs[len(logs)-1].Message, "Rerouted provider anthropic -> bedrock")
}

// TestEnsureProviderWithAccessibleKeys_GrayscaleReroute_MultiKeyTarget reproduces the
// scenario where the original provider's keys exclude the user, and the target provider
// has MULTIPLE keys of which only one grayscale-includes the user.
func TestEnsureProviderWithAccessibleKeys_GrayscaleReroute_MultiKeyTarget(t *testing.T) {
	logger := NewMockLogger()
	grayscaleOn := true
	mc := modelcatalog.NewTestCatalog(map[string]string{
		"claude-mythos-preview-fast": "claude-mythos-preview-fast",
	})
	mc.UpsertModelDataForProvider(schemas.Anthropic, &schemas.BifrostListModelsResponse{
		Data: []schemas.Model{{ID: "anthropic/claude-mythos-preview-fast"}},
	}, nil)
	mc.UpsertModelDataForProvider(schemas.Bedrock, &schemas.BifrostListModelsResponse{
		Data: []schemas.Model{{ID: "bedrock/claude-mythos-preview-fast"}},
	}, nil)

	vk := buildVirtualKeyWithProviders(
		"vk-gray-multikey",
		"sk-bf-gray-multikey",
		"gray-multikey-vk",
		[]configstoreTables.TableVirtualKeyProviderConfig{
			func() configstoreTables.TableVirtualKeyProviderConfig {
				pc := buildProviderConfig("anthropic", []string{"*"})
				pc.AllowAllKeys = true
				return pc
			}(),
			func() configstoreTables.TableVirtualKeyProviderConfig {
				pc := buildProviderConfig("bedrock", []string{"*"})
				pc.AllowAllKeys = true
				return pc
			}(),
		},
	)

	store, err := NewLocalGovernanceStore(context.Background(), logger, nil, &configstore.GovernanceConfig{
		VirtualKeys: []configstoreTables.TableVirtualKey{*vk},
	}, mc)
	require.NoError(t, err)

	inMemoryStore := &mockInMemoryStore{
		configuredProviders: map[schemas.ModelProvider]configstore.ProviderConfig{
			schemas.Anthropic: {
				Keys: []schemas.Key{{
					ID:               "anthropic-gray",
					Name:             "anthropic-gray",
					Value:            *schemas.NewEnvVar("sk-anthropic"),
					Models:           []string{"claude-mythos-preview-fast"},
					GrayscaleEnabled: &grayscaleOn,
					GrayscaleUsers:   []string{"user-a"},
				}},
			},
			schemas.Bedrock: {
				Keys: []schemas.Key{
					{
						ID:               "bedrock-gray-a",
						Name:             "bedrock-gray-a",
						Value:            *schemas.NewEnvVar("sk-bedrock-a"),
						Models:           []string{"claude-mythos-preview-fast"},
						GrayscaleEnabled: &grayscaleOn,
						GrayscaleUsers:   []string{"user-a"},
					},
					{
						ID:               "bedrock-gray-b",
						Name:             "bedrock-gray-b",
						Value:            *schemas.NewEnvVar("sk-bedrock-b"),
						Models:           []string{"claude-mythos-preview-fast"},
						GrayscaleEnabled: &grayscaleOn,
						GrayscaleUsers:   []string{"user-b"},
					},
				},
			},
		},
	}

	plugin, err := InitFromStore(context.Background(), &Config{IsVkMandatory: boolPtr(false)}, logger, store, nil, mc, nil, inMemoryStore)
	require.NoError(t, err)
	defer func() {
		require.NoError(t, plugin.Cleanup())
	}()

	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	ctx.SetValue(schemas.BifrostContextKeyUserID, "user-b")
	ctx.SetValue(schemas.BifrostContextKeyVirtualKey, vk.Value)

	req := &schemas.BifrostRequest{
		RequestType: schemas.ChatCompletionRequest,
		ChatRequest: &schemas.BifrostChatRequest{
			Provider: schemas.Anthropic,
			Model:    "claude-mythos-preview-fast",
		},
	}

	plugin.ensureProviderWithAccessibleKeys(ctx, req, vk.Value)
	require.Equal(t, schemas.Bedrock, req.ChatRequest.Provider)
}

// TestPreLLMHook_ResolvesUserFromVirtualKeyForGrayscaleReroute reproduces the device
// temporary credential flow: auth rewrites the Authorization header to the user's VK
// but never sets BifrostContextKeyUserID, so grayscale checks previously ran with an
// empty user and rejected every grayscale key — even when another provider had a key
// whose grayscale list includes the user.
func TestPreLLMHook_ResolvesUserFromVirtualKeyForGrayscaleReroute(t *testing.T) {
	logger := NewMockLogger()
	grayscaleOn := true
	mc := modelcatalog.NewTestCatalog(map[string]string{
		"claude-mythos-preview-fast": "claude-mythos-preview-fast",
	})
	mc.UpsertModelDataForProvider(schemas.Anthropic, &schemas.BifrostListModelsResponse{
		Data: []schemas.Model{{ID: "anthropic/claude-mythos-preview-fast"}},
	}, nil)
	mc.UpsertModelDataForProvider(schemas.Bedrock, &schemas.BifrostListModelsResponse{
		Data: []schemas.Model{{ID: "bedrock/claude-mythos-preview-fast"}},
	}, nil)

	vk := buildVirtualKeyWithProviders(
		"vk-gray-vkuser",
		"sk-bf-gray-vkuser",
		"gray-vkuser-vk",
		[]configstoreTables.TableVirtualKeyProviderConfig{
			func() configstoreTables.TableVirtualKeyProviderConfig {
				pc := buildProviderConfig("anthropic", []string{"*"})
				pc.AllowAllKeys = true
				return pc
			}(),
			func() configstoreTables.TableVirtualKeyProviderConfig {
				pc := buildProviderConfig("bedrock", []string{"*"})
				pc.AllowAllKeys = true
				return pc
			}(),
		},
	)
	createdBy := "user-b"
	vk.CreatedByUserID = &createdBy

	store, err := NewLocalGovernanceStore(context.Background(), logger, nil, &configstore.GovernanceConfig{
		VirtualKeys: []configstoreTables.TableVirtualKey{*vk},
	}, mc)
	require.NoError(t, err)

	inMemoryStore := &mockInMemoryStore{
		configuredProviders: map[schemas.ModelProvider]configstore.ProviderConfig{
			schemas.Anthropic: {
				Keys: []schemas.Key{{
					ID:               "anthropic-gray",
					Name:             "anthropic-gray",
					Value:            *schemas.NewEnvVar("sk-anthropic"),
					Models:           []string{"claude-mythos-preview-fast"},
					GrayscaleEnabled: &grayscaleOn,
					GrayscaleUsers:   []string{"user-a"},
				}},
			},
			schemas.Bedrock: {
				Keys: []schemas.Key{
					{
						ID:               "bedrock-gray-a",
						Name:             "bedrock-gray-a",
						Value:            *schemas.NewEnvVar("sk-bedrock-a"),
						Models:           []string{"claude-mythos-preview-fast"},
						GrayscaleEnabled: &grayscaleOn,
						GrayscaleUsers:   []string{"user-a"},
					},
					{
						ID:               "bedrock-gray-b",
						Name:             "bedrock-gray-b",
						Value:            *schemas.NewEnvVar("sk-bedrock-b"),
						Models:           []string{"claude-mythos-preview-fast"},
						GrayscaleEnabled: &grayscaleOn,
						GrayscaleUsers:   []string{"user-b"},
					},
				},
			},
		},
	}

	plugin, err := InitFromStore(context.Background(), &Config{IsVkMandatory: boolPtr(false)}, logger, store, nil, mc, nil, inMemoryStore)
	require.NoError(t, err)
	defer func() {
		require.NoError(t, plugin.Cleanup())
	}()

	// Simulate the device-credential flow: VK resolved by auth, user ID NOT in context.
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	ctx.SetValue(schemas.BifrostContextKeyVirtualKey, vk.Value)

	req := &schemas.BifrostRequest{
		RequestType: schemas.ChatCompletionRequest,
		ChatRequest: &schemas.BifrostChatRequest{
			Provider: schemas.Anthropic,
			Model:    "claude-mythos-preview-fast",
		},
	}

	_, shortCircuit, hookErr := plugin.PreLLMHook(ctx, req)
	require.NoError(t, hookErr)
	require.Nil(t, shortCircuit)

	// The user must be resolved from the VK so grayscale checks (here and in core
	// key selection) see the actual user instead of an empty string.
	require.Equal(t, "user-b", bifrost.GetStringFromContext(ctx, schemas.BifrostContextKeyUserID))
	require.Equal(t, schemas.Bedrock, req.ChatRequest.Provider)
}
