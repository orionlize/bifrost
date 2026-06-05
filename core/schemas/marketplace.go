package schemas

// MarketplaceItemType distinguishes skills from plugin bundles in the unified catalog.
type MarketplaceItemType string

const (
	MarketplaceItemTypeSkill  MarketplaceItemType = "skill"
	MarketplaceItemTypePlugin MarketplaceItemType = "plugin"
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

// MarketplaceConfig holds marketplace-wide metadata persisted in client config.
type MarketplaceConfig struct {
	Name       string           `json:"name"`
	Owner      MarketplaceOwner   `json:"owner"`
	PublicRead bool             `json:"public_read,omitempty"`
}

// MarketplaceItemBundle is the stored content payload for a catalog item.
type MarketplaceItemBundle struct {
	// PluginJSON holds .claude-plugin/plugin.json for plugin items.
	PluginJSON map[string]any `json:"plugin_json,omitempty"`
	// SkillMD holds SKILL.md frontmatter+body for standalone skill items.
	SkillMD string `json:"skill_md,omitempty"`
	// Files maps relative paths (e.g. agents/foo.md, skills/bar/SKILL.md) to file contents.
	Files map[string]string `json:"files,omitempty"`
}
