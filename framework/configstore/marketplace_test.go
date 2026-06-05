package configstore

import (
	"context"
	"testing"
	"time"

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
		&tables.TableMarketplaceItemAssignment{},
		&tables.AoneUserTable{},
		&tables.AoneDepartmentTable{},
		&tables.AoneUserDepartmentTable{},
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
	require.Equal(t, "./marketplace/claude/plugins/data-toolkit", manifest.Plugins[0].Source)
	require.Equal(t, "./marketplace/claude/skills/docs-skill", manifest.Plugins[1].Source)
}

func TestBuildCodexMarketplaceManifest(t *testing.T) {
	cfg := &schemas.MarketplaceConfig{
		Name: "codex-marketplace",
		Owner: schemas.MarketplaceOwner{
			Name: "Codex Owner",
		},
	}
	items := []tables.TableMarketplaceItem{
		{Name: "codex-plugin", ItemType: schemas.MarketplaceItemTypePlugin, Platform: schemas.MarketplacePlatformCodex, Enabled: true},
		{Name: "claude-only", ItemType: schemas.MarketplaceItemTypePlugin, Platform: schemas.MarketplacePlatformClaude, Enabled: true},
	}

	manifest := BuildCodexMarketplaceManifest(cfg, items)
	require.Equal(t, "codex-marketplace", manifest.Name)
	require.Len(t, manifest.Plugins, 1)
	require.Equal(t, "codex-plugin", manifest.Plugins[0].Name)
	require.Equal(t, "./marketplace/codex/plugins/codex-plugin", manifest.Plugins[0].Source.Path)
	require.Equal(t, "AVAILABLE", manifest.Plugins[0].Policy.Installation)
}

func TestMarketplaceItemAssignments(t *testing.T) {
	db := setupMarketplaceTestDB(t)
	store := &RDBConfigStore{}
	store.db.Store(db)
	ctx := context.Background()

	user := tables.AoneUserTable{
		AoneUserID:    "user-1",
		Email:         "user@example.com",
		Name:          "User One",
		DingtalkJSON:  `{"departments":[{"deptId":10,"name":"Engineering"}]}`,
		DepartmentNames: "Engineering",
	}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Create(&tables.AoneDepartmentTable{DeptID: 10, Name: "Engineering", FullPath: "Engineering"}).Error)
	require.NoError(t, db.Create(&tables.AoneUserDepartmentTable{AoneUserID: user.AoneUserID, DeptID: 10, CreatedAt: time.Now()}).Error)

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

	require.NoError(t, store.ReplaceMarketplaceItemAssignments(ctx, skill.ID, &schemas.MarketplaceItemAssignmentsUpdate{
		Users: []string{user.AoneUserID},
	}))
	items, err := store.GetMarketplaceItemsForUser(ctx, user.AoneUserID)
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, "docs-skill", items[0].Name)

	require.NoError(t, store.ReplaceMarketplaceItemAssignments(ctx, plugin.ID, &schemas.MarketplaceItemAssignmentsUpdate{
		Departments: []string{"10"},
	}))
	items, err = store.GetMarketplaceItemsForUser(ctx, user.AoneUserID)
	require.NoError(t, err)
	require.Len(t, items, 2)

	var legacyAssignments []tables.TableMarketplaceUserAssignment
	require.NoError(t, db.Find(&legacyAssignments).Error)
	require.Len(t, legacyAssignments, 1)
	require.Equal(t, user.AoneUserID, legacyAssignments[0].AoneUserID)
	require.Equal(t, skill.ID, legacyAssignments[0].ItemID)
}
