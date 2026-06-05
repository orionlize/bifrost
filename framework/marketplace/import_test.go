package marketplace

import (
	"archive/zip"
	"bytes"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"
)

func TestImportFromZipCodexPlugin(t *testing.T) {
	data := buildTestZip(t, map[string]string{
		"repo-main/.codex-plugin/plugin.json": `{"name":"codex-toolkit","description":"Codex tools","version":"1.0.0","interface":{"displayName":"Codex Toolkit"}}`,
	})

	result, err := ImportFromZip(data, ImportOptions{})
	require.NoError(t, err)
	require.Equal(t, schemas.MarketplacePlatformCodex, result.Platform)
	require.Equal(t, schemas.MarketplaceItemTypePlugin, result.ItemType)
	require.Equal(t, "codex-toolkit", result.Name)
}

func TestImportFromZipPlugin(t *testing.T) {
	data := buildTestZip(t, map[string]string{
		"repo-main/.claude-plugin/plugin.json": `{"name":"data-toolkit","description":"Data tools","version":"2.0.0"}`,
		"repo-main/agents/data-engineer.md":    "# Data Engineer",
	})

	result, err := ImportFromZip(data, ImportOptions{})
	require.NoError(t, err)
	require.Equal(t, schemas.MarketplaceItemTypePlugin, result.ItemType)
	require.Equal(t, schemas.MarketplacePlatformClaude, result.Platform)
	require.Equal(t, "data-toolkit", result.Name)
	require.Equal(t, "Data tools", result.Description)
	require.Equal(t, "2.0.0", result.Version)
	require.NotNil(t, result.Bundle.PluginJSON)
	require.Equal(t, "# Data Engineer", result.Bundle.Files["agents/data-engineer.md"])
}

func TestImportFromZipSkill(t *testing.T) {
	data := buildTestZip(t, map[string]string{
		"docs-skill-main/SKILL.md": "---\nname: docs-skill\ndescription: Docs helper\n---\nBody",
	})

	result, err := ImportFromZip(data, ImportOptions{})
	require.NoError(t, err)
	require.Equal(t, schemas.MarketplaceItemTypeSkill, result.ItemType)
	require.Equal(t, "docs-skill", result.Name)
	require.Equal(t, "Docs helper", result.Description)
	require.Contains(t, result.Bundle.SkillMD, "Body")
}

func TestGitArchiveURLGitHub(t *testing.T) {
	archiveURL, err := gitArchiveURL("https://github.com/maximhq/bifrost", "main", schemas.MarketplaceImportSourceGitHub)
	require.NoError(t, err)
	require.Equal(t, "https://codeload.github.com/maximhq/bifrost/zip/refs/heads/main", archiveURL)
}

func TestGitArchiveURLGitLab(t *testing.T) {
	archiveURL, err := gitArchiveURL("https://gitlab.com/group/subgroup/repo", "main", schemas.MarketplaceImportSourceGitLab)
	require.NoError(t, err)
	require.Contains(t, archiveURL, "/api/v4/projects/group%2Fsubgroup%2Frepo/repository/archive.zip")
}

func TestGitArchiveURLGitLabSelfHosted(t *testing.T) {
	archiveURL, err := gitArchiveURL("https://git.example.com/group/subgroup/repo", "main", schemas.MarketplaceImportSourceGitLab)
	require.NoError(t, err)
	require.Equal(t, "https://git.example.com/api/v4/projects/group%2Fsubgroup%2Frepo/repository/archive.zip?sha=main", archiveURL)
}

func buildTestZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	buf := &bytes.Buffer{}
	writer := zip.NewWriter(buf)
	for name, content := range files {
		entry, err := writer.Create(name)
		require.NoError(t, err)
		_, err = entry.Write([]byte(content))
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	return buf.Bytes()
}
