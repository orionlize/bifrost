package configstore

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupMarketplaceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&tables.TableMarketplaceItem{},
		&tables.TableMarketplaceUserAssignment{},
		&tables.AoneUserTable{},
	))
	return db
}

func TestBuildMarketplaceManifest(t *testing.T) {
	cfg := &schemas.MarketplaceConfig{
		Name: "test-marketplace",
		Owner: schemas.MarketplaceOwner{
			Name:  "Test Owner",
			Email: "owner@example.com",
		},
	}
	items := []tables.TableMarketplaceItem{
		{Name: "data-toolkit", ItemType: schemas.MarketplaceItemTypePlugin, Description: "Data plugin", Enabled: true},
		{Name: "docs-skill", ItemType: schemas.MarketplaceItemTypeSkill, Description: "Docs skill", Enabled: true},
		{Name: "disabled", ItemType: schemas.MarketplaceItemTypePlugin, Enabled: false},
	}

	manifest := BuildMarketplaceManifest(cfg, items)
	require.Equal(t, "test-marketplace", manifest.Name)
	require.Equal(t, "Test Owner", manifest.Owner.Name)
	require.Len(t, manifest.Plugins, 2)
	require.Equal(t, "data-toolkit", manifest.Plugins[0].Name)
	require.Equal(t, "./marketplace/plugins/data-toolkit", manifest.Plugins[0].Source)
	require.Equal(t, "./marketplace/skills/docs-skill", manifest.Plugins[1].Source)
}

func TestMarketplaceUserAssignments(t *testing.T) {
	db := setupMarketplaceTestDB(t)
	store := &RDBConfigStore{}
	store.db.Store(db)
	ctx := context.Background()

	user := tables.AoneUserTable{
		AoneUserID: "user-1",
		Email:      "user@example.com",
		Name:       "User One",
	}
	require.NoError(t, db.Create(&user).Error)

	skill := &tables.TableMarketplaceItem{
		Name:     "docs-skill",
		ItemType: schemas.MarketplaceItemTypeSkill,
		Enabled:  true,
		Source:   "./marketplace/skills/docs-skill",
		Content:  &schemas.MarketplaceItemBundle{SkillMD: "---\nname: docs-skill\n---\n"},
	}
	require.NoError(t, store.CreateMarketplaceItem(ctx, skill))

	plugin := &tables.TableMarketplaceItem{
		Name:     "data-toolkit",
		ItemType: schemas.MarketplaceItemTypePlugin,
		Enabled:  true,
		Source:   "./marketplace/plugins/data-toolkit",
	}
	require.NoError(t, store.CreateMarketplaceItem(ctx, plugin))

	require.NoError(t, store.ReplaceMarketplaceUserAssignments(ctx, user.AoneUserID, []uint{skill.ID}))
	items, err := store.GetMarketplaceItemsForUser(ctx, user.AoneUserID)
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, "docs-skill", items[0].Name)

	require.NoError(t, store.AddMarketplaceUserAssignments(ctx, user.AoneUserID, []uint{plugin.ID}))
	items, err = store.GetMarketplaceItemsForUser(ctx, user.AoneUserID)
	require.NoError(t, err)
	require.Len(t, items, 2)

	require.NoError(t, store.RemoveMarketplaceUserAssignment(ctx, user.AoneUserID, skill.ID))
	items, err = store.GetMarketplaceItemsForUser(ctx, user.AoneUserID)
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, "data-toolkit", items[0].Name)
}
