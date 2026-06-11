package governance

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/modelcatalog"
	"github.com/stretchr/testify/require"
)

func TestParseGlobalAPIKeyBearerToken(t *testing.T) {
	req := schemas.AcquireHTTPRequest()
	defer schemas.ReleaseHTTPRequest(req)

	req.Headers["Authorization"] = "Bearer "+configstore.GlobalAPIKeyPrefix+"abcd"
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
