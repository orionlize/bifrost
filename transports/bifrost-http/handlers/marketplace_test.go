package handlers

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
)

func TestResolveMarketplaceContentSkill(t *testing.T) {
	item := &tables.TableMarketplaceItem{
		Name:     "docs-skill",
		ItemType: schemas.MarketplaceItemTypeSkill,
		Content: &schemas.MarketplaceItemBundle{
			SkillMD: "---\nname: docs-skill\n---\nBody",
		},
	}

	content, contentType, ok := resolveMarketplaceContent(item, "SKILL.md")
	require.True(t, ok)
	require.Contains(t, content, "docs-skill")
	require.Equal(t, "text/markdown; charset=utf-8", contentType)
}

func TestResolveMarketplaceContentPluginJSON(t *testing.T) {
	item := &tables.TableMarketplaceItem{
		Name:     "data-toolkit",
		ItemType: schemas.MarketplaceItemTypePlugin,
		Version:  "1.2.0",
		Content: &schemas.MarketplaceItemBundle{
			PluginJSON: map[string]any{
				"name":    "data-toolkit",
				"version": "1.2.0",
			},
			Files: map[string]string{
				"agents/data-engineer.md": "# Data Engineer",
			},
		},
	}

	content, contentType, ok := resolveMarketplaceContent(item, ".claude-plugin/plugin.json")
	require.True(t, ok)
	require.Contains(t, content, "data-toolkit")
	require.Equal(t, "application/json; charset=utf-8", contentType)

	content, contentType, ok = resolveMarketplaceContent(item, "agents/data-engineer.md")
	require.True(t, ok)
	require.Equal(t, "# Data Engineer", content)
	require.Equal(t, "text/markdown; charset=utf-8", contentType)
}

func TestDefaultMarketplaceItemSource(t *testing.T) {
	skill := &tables.TableMarketplaceItem{Name: "docs-skill", ItemType: schemas.MarketplaceItemTypeSkill}
	plugin := &tables.TableMarketplaceItem{Name: "data-toolkit", ItemType: schemas.MarketplaceItemTypePlugin}
	require.Equal(t, "./marketplace/skills/docs-skill", defaultMarketplaceItemSource(skill))
	require.Equal(t, "./marketplace/plugins/data-toolkit", defaultMarketplaceItemSource(plugin))
}
