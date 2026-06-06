package marketplace

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"
)

func TestResolveMarketplaceManifestURLCodexPreset(t *testing.T) {
	manifestURL, ctx, err := ResolveMarketplaceManifestURL("hashgraph-online/awesome-codex-plugins")
	require.NoError(t, err)
	require.Contains(t, manifestURL, ".agents/plugins/marketplace.json")
	require.NotNil(t, ctx)
	require.Equal(t, "hashgraph-online", ctx.Owner)
	require.Equal(t, "awesome-codex-plugins", ctx.Repo)
}

func TestParsePluginSourceSpecLocal(t *testing.T) {
	spec, err := parsePluginSourceSpec([]byte(`{
		"source": "local",
		"path": "./plugins/demo"
	}`), &marketplaceRepoContext{
		Owner: "hashgraph-online",
		Repo:  "awesome-codex-plugins",
		Ref:   "main",
	})
	require.NoError(t, err)
	require.Equal(t, "plugins/demo", spec.subDir)
	require.Contains(t, spec.repoURL, "awesome-codex-plugins")
}

func TestInferCatalogSourcePlatform(t *testing.T) {
	require.Equal(t, schemas.MarketplacePlatformClaude, InferCatalogSourcePlatform("https://raw.githubusercontent.com/a/b/main/.claude-plugin/marketplace.json"))
	require.Equal(t, schemas.MarketplacePlatformCodex, InferCatalogSourcePlatform("https://raw.githubusercontent.com/a/b/main/.agents/plugins/marketplace.json"))
}

func TestResolveMarketplaceManifestURLOfficialPreset(t *testing.T) {
	manifestURL, ctx, err := ResolveMarketplaceManifestURL("anthropics/claude-plugins-official")
	require.NoError(t, err)
	require.Contains(t, manifestURL, "claude-plugins-official")
	require.NotNil(t, ctx)
	require.Equal(t, "anthropics", ctx.Owner)
	require.Equal(t, "claude-plugins-official", ctx.Repo)
}

func TestResolveMarketplaceManifestURLGitHubShorthand(t *testing.T) {
	manifestURL, ctx, err := ResolveMarketplaceManifestURL("anthropics/claude-plugins-official")
	require.NoError(t, err)
	require.Contains(t, manifestURL, "marketplace.json")
	require.NotNil(t, ctx)
}

func TestParsePluginSourceSpecRelative(t *testing.T) {
	spec, err := parsePluginSourceSpec([]byte(`"./plugins/agent-sdk-dev"`), &marketplaceRepoContext{
		Owner: "anthropics",
		Repo:  "claude-plugins-official",
		Ref:   "main",
	})
	require.NoError(t, err)
	require.Equal(t, "plugins/agent-sdk-dev", spec.subDir)
	require.Contains(t, spec.repoURL, "anthropics/claude-plugins-official")
}

func TestParsePluginSourceSpecGitSubdir(t *testing.T) {
	spec, err := parsePluginSourceSpec([]byte(`{
		"source": "git-subdir",
		"url": "https://github.com/42Crunch-AI/claude-plugins.git",
		"path": "plugins/api-security-testing",
		"ref": "v1.5.5"
	}`), nil)
	require.NoError(t, err)
	require.Equal(t, "plugins/api-security-testing", spec.subDir)
	require.Equal(t, "v1.5.5", spec.ref)
}

func TestFilterArchiveContents(t *testing.T) {
	contents := &archiveContents{
		Files: map[string][]byte{
			"plugins/demo/.claude-plugin/plugin.json": []byte(`{"name":"demo"}`),
			"plugins/demo/agents/a.md":                []byte("# Agent"),
			"plugins/other/SKILL.md":                  []byte("---\nname: other\n---\n"),
		},
	}
	filtered, err := filterArchiveContents(contents, "plugins/demo")
	require.NoError(t, err)
	require.Contains(t, filtered.Files, ".claude-plugin/plugin.json")
	require.Contains(t, filtered.Files, "agents/a.md")
	require.NotContains(t, filtered.Files, "plugins/other/SKILL.md")
}

func TestGitHubCodeloadArchiveURL(t *testing.T) {
	require.Contains(t, gitHubCodeloadArchiveURL("o", "r", "main"), "refs/heads/main")
	require.Contains(t, gitHubCodeloadArchiveURL("o", "r", "v1.0.0"), "refs/tags/v1.0.0")
	require.Contains(t, gitHubCodeloadArchiveURL("o", "r", "a175b24f7b34852b70c78c21545cce8037eb3112"), "/zip/a175b24")
}
