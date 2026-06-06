package marketplace

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"
)

func TestParseGitLabRemoteURLTreeRef(t *testing.T) {
	targets, err := parseGitLabRemoteURL("https://git.example.com/group/sub/repo/-/tree/develop", "main")
	require.NoError(t, err)
	require.Len(t, targets, 1)
	require.Equal(t, "group/sub/repo", targets[0].projectPath)
	require.Equal(t, "develop", targets[0].ref)
}

func TestParseGitLabRemoteURLSubpathMount(t *testing.T) {
	targets, err := parseGitLabRemoteURL("https://git.example.com/gitlab/mygroup/myproj", "main")
	require.NoError(t, err)
	require.Len(t, targets, 2)
	require.Equal(t, "https://git.example.com/gitlab/api/v4", targets[0].apiBase)
	require.Equal(t, "mygroup/myproj", targets[0].projectPath)
	require.Equal(t, "https://git.example.com/api/v4", targets[1].apiBase)
	require.Equal(t, "mygroup/myproj", targets[1].projectPath)
}

func TestParseGitLabRemoteURLSubpathTreeMain(t *testing.T) {
	targets, err := parseGitLabRemoteURL(
		"https://xxx/gitlab/incubator/frontend/admin-knowledge/-/tree/main",
		"main",
	)
	require.NoError(t, err)
	require.Len(t, targets, 2)
	require.Equal(t, "https://xxx/gitlab/api/v4", targets[0].apiBase)
	require.Equal(t, "incubator/frontend/admin-knowledge", targets[0].projectPath)
	require.Equal(t, "main", targets[0].ref)
	require.Equal(t, "https://xxx/gitlab/api/v4/projects/incubator%2Ffrontend%2Fadmin-knowledge/repository/archive.zip?sha=main",
		gitLabArchiveCandidates(targets[0], "")[0])
}

func TestGitLabWebArchiveCandidatesSubpath(t *testing.T) {
	targets, err := parseGitLabRemoteURL(
		"https://xxx/gitlab/incubator/frontend/admin-knowledge/-/tree/main",
		"main",
	)
	require.NoError(t, err)
	urls := gitLabWebArchiveCandidates(targets[0])
	require.NotEmpty(t, urls)
	require.Contains(t, urls[0], "https://xxx/gitlab/incubator/frontend/admin-knowledge/-/archive/main/admin-knowledge-main.zip")
	require.Contains(t, urls, "https://xxx/gitlab/incubator/frontend/admin-knowledge/repository/archive.zip?ref=main")
}

func TestLooksLikeHTMLArchive(t *testing.T) {
	require.True(t, looksLikeHTMLArchive([]byte("<!DOCTYPE html><html>")))
	require.False(t, looksLikeHTMLArchive([]byte("PK\x03\x04")))
}

func TestGitLabArchiveCandidatesUsesProjectID(t *testing.T) {
	urls := gitLabArchiveCandidates(gitLabTarget{
		apiBase:     "https://git.example.com/api/v4",
		projectPath: "group/repo",
		ref:         "main",
	}, "42")
	require.Contains(t, urls[0], "/projects/42/repository/archive.zip")
	require.NotContains(t, urls[0], "%2F")
}

func TestGitArchiveURLGitLabWebURL(t *testing.T) {
	archiveURL, err := gitArchiveURL("https://gitlab.com/foo/bar/-/tree/release-1.0", "main", schemas.MarketplaceImportSourceGitLab)
	require.NoError(t, err)
	require.Contains(t, archiveURL, "foo%2Fbar")
	require.Contains(t, archiveURL, "sha=release-1.0")
}
