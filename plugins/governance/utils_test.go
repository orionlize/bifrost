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
