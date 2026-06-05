package schemas

// MarketplaceItemType distinguishes skills from plugin bundles in the unified catalog.
type MarketplaceItemType string

const (
	MarketplaceItemTypeSkill  MarketplaceItemType = "skill"
	MarketplaceItemTypePlugin MarketplaceItemType = "plugin"
)

// MarketplacePlatform identifies the target CLI ecosystem for a catalog item.
type MarketplacePlatform string

const (
	MarketplacePlatformClaude MarketplacePlatform = "claude"
	MarketplacePlatformCodex  MarketplacePlatform = "codex"
)

// MarketplaceImportSourceType describes how catalog item content was imported.
type MarketplaceImportSourceType string

const (
	MarketplaceImportSourceZip      MarketplaceImportSourceType = "zip"
	MarketplaceImportSourceGitHub   MarketplaceImportSourceType = "github"
	MarketplaceImportSourceGitLab   MarketplaceImportSourceType = "gitlab"
	MarketplaceImportSourceCatalog  MarketplaceImportSourceType = "catalog"
)

// MarketplaceOwner describes the marketplace publisher shown in marketplace.json manifests.
type MarketplaceOwner struct {
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
}

// MarketplaceManifestEntry is a single plugin or skill entry in a Claude Code compatible manifest.
type MarketplaceManifestEntry struct {
	Name        string `json:"name"`
	Source      string `json:"source"`
	Description string `json:"description,omitempty"`
	Version     string `json:"version,omitempty"`
}

// MarketplaceManifest is the Claude Code compatible marketplace.json root object.
type MarketplaceManifest struct {
	Name    string                     `json:"name"`
	Owner   MarketplaceOwner           `json:"owner"`
	Plugins []MarketplaceManifestEntry `json:"plugins"`
}

// CodexMarketplaceManifest is the Codex CLI compatible marketplace.json root object.
type CodexMarketplaceManifest struct {
	Name      string                      `json:"name"`
	Interface *CodexMarketplaceInterface  `json:"interface,omitempty"`
	Plugins   []CodexMarketplacePluginEntry `json:"plugins"`
}

// CodexMarketplaceInterface holds Codex marketplace display metadata.
type CodexMarketplaceInterface struct {
	DisplayName string `json:"displayName,omitempty"`
}

// CodexMarketplacePluginEntry is a single plugin entry in a Codex marketplace manifest.
type CodexMarketplacePluginEntry struct {
	Name        string                   `json:"name"`
	DisplayName string                   `json:"displayName,omitempty"`
	Source      CodexMarketplaceSourceRef  `json:"source"`
	Policy      CodexMarketplacePolicy     `json:"policy"`
	Category    string                   `json:"category,omitempty"`
	Description string                   `json:"description,omitempty"`
}

// CodexMarketplaceSourceRef points at a plugin bundle path relative to the marketplace root.
type CodexMarketplaceSourceRef struct {
	Source string `json:"source"`
	Path   string `json:"path"`
}

// CodexMarketplacePolicy controls Codex plugin installation behavior.
type CodexMarketplacePolicy struct {
	Installation   string `json:"installation"`
	Authentication string `json:"authentication"`
}

// MarketplaceConfig holds marketplace-wide metadata persisted in client config.
type MarketplaceConfig struct {
	Name           string                    `json:"name"`
	Owner          MarketplaceOwner          `json:"owner"`
	PublicRead     bool                      `json:"public_read,omitempty"`
	CatalogSources []MarketplaceCatalogSource `json:"catalog_sources,omitempty"`
}

// MarketplaceUserGitCredentialsStatus describes saved git tokens without exposing secret values.
type MarketplaceUserGitCredentialsStatus struct {
	GitHubTokenConfigured bool `json:"github_token_configured"`
	GitLabTokenConfigured bool `json:"gitlab_token_configured"`
}

// MarketplaceUserGitCredentialsUpdate updates per-user git tokens for marketplace imports.
// Omit a field to keep the existing value; set to empty string to clear.
type MarketplaceUserGitCredentialsUpdate struct {
	GitHubToken *string `json:"github_token,omitempty"`
	GitLabToken *string `json:"gitlab_token,omitempty"`
}

// MarketplaceAssignmentTarget identifies a user or department assignment target.
type MarketplaceAssignmentTarget struct {
	Type string `json:"type"` // "user" | "department"
	ID   string `json:"id"`
}

// MarketplaceItemAssignmentsUpdate replaces all assignments for a catalog item.
type MarketplaceItemAssignmentsUpdate struct {
	Users       []string `json:"users,omitempty"`
	Departments []string `json:"departments,omitempty"`
}

// MarketplaceCatalogSource is a configured remote plugin marketplace manifest source.
type MarketplaceCatalogSource struct {
	ID          string                `json:"id"`
	Label       string                `json:"label"`
	URL         string                `json:"url"`
	Platform    MarketplacePlatform   `json:"platform,omitempty"`
	Description string                `json:"description,omitempty"`
	Official    bool                  `json:"official,omitempty"`
	Enabled     *bool                 `json:"enabled,omitempty"`
}

// MarketplaceItemBundle is the stored content payload for a catalog item.
type MarketplaceItemBundle struct {
	// PluginJSON holds .claude-plugin/plugin.json or .codex-plugin/plugin.json for plugin items.
	PluginJSON map[string]any `json:"plugin_json,omitempty"`
	// SkillMD holds SKILL.md frontmatter+body for standalone skill items.
	SkillMD string `json:"skill_md,omitempty"`
	// Files maps relative paths (e.g. agents/foo.md, skills/bar/SKILL.md) to file contents.
	Files map[string]string `json:"files,omitempty"`
}
