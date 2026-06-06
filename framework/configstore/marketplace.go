package configstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/marketplace"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
)

const marketplaceMetadataKey = "marketplace"

// MarketplaceItemsQueryParams holds pagination and search parameters for marketplace item queries.
type MarketplaceItemsQueryParams struct {
	Limit    int
	Offset   int
	Search   string
	ItemType string
	Platform string
	Enabled  *bool
}

// GetMarketplaceConfig returns marketplace-wide metadata from client config.
func (s *RDBConfigStore) GetMarketplaceConfig(ctx context.Context) (*schemas.MarketplaceConfig, error) {
	metadata, err := s.GetClientMetadata(ctx)
	if err != nil {
		return nil, err
	}
	if metadata == nil {
		return defaultMarketplaceConfig(), nil
	}
	raw, ok := metadata[marketplaceMetadataKey]
	if !ok || raw == nil {
		return defaultMarketplaceConfig(), nil
	}
	data, err := jsonMarshal(raw)
	if err != nil {
		return nil, err
	}
	var cfg schemas.MarketplaceConfig
	if err := jsonUnmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse marketplace config: %w", err)
	}
	normalizeMarketplaceConfig(&cfg)
	if strings.TrimSpace(cfg.Name) == "" {
		cfg.Name = defaultMarketplaceConfig().Name
	}
	return &cfg, nil
}

// UpdateMarketplaceConfig persists marketplace-wide metadata into client config.
func (s *RDBConfigStore) UpdateMarketplaceConfig(ctx context.Context, cfg *schemas.MarketplaceConfig) error {
	if cfg == nil {
		return fmt.Errorf("marketplace config is nil")
	}
	normalizeMarketplaceConfig(cfg)
	data, err := jsonMarshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal marketplace config: %w", err)
	}
	var asMap map[string]any
	if err := jsonUnmarshal(data, &asMap); err != nil {
		return fmt.Errorf("decode marketplace config map: %w", err)
	}
	patch := map[string]any{marketplaceMetadataKey: asMap}
	return s.UpdateClientMetadata(ctx, patch)
}

func normalizeMarketplaceConfig(cfg *schemas.MarketplaceConfig) {
	if cfg == nil {
		return
	}
	seen := make(map[string]struct{}, len(cfg.CatalogSources))
	for i := range cfg.CatalogSources {
		source := &cfg.CatalogSources[i]
		source.Label = strings.TrimSpace(source.Label)
		source.URL = strings.TrimSpace(source.URL)
		source.Description = strings.TrimSpace(source.Description)
		if source.Platform == "" {
			source.Platform = marketplace.InferCatalogSourcePlatform(source.URL)
		}
		if source.ID == "" {
			source.ID = marketplaceCatalogSourceID(source.Label, source.URL, i)
		}
		if _, ok := seen[source.ID]; ok {
			source.ID = fmt.Sprintf("%s-%d", source.ID, i+1)
		}
		seen[source.ID] = struct{}{}
	}
}

func marketplaceCatalogSourceID(label, rawURL string, index int) string {
	base := strings.ToLower(label)
	base = strings.NewReplacer(" ", "-", "_", "-", "/", "-").Replace(base)
	base = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		return -1
	}, base)
	base = strings.Trim(base, "-")
	if base == "" {
		base = fmt.Sprintf("source-%d", index+1)
	}
	if rawURL != "" {
		parts := strings.Split(strings.Trim(strings.TrimPrefix(strings.TrimPrefix(rawURL, "https://"), "http://"), "/"), "/")
		if len(parts) >= 2 {
			slug := strings.ToLower(parts[0] + "-" + strings.TrimSuffix(parts[1], ".git"))
			slug = strings.Map(func(r rune) rune {
				if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
					return r
				}
				return -1
			}, slug)
			slug = strings.Trim(slug, "-")
			if slug != "" {
				return slug
			}
		}
	}
	return base
}

func defaultMarketplaceConfig() *schemas.MarketplaceConfig {
	return &schemas.MarketplaceConfig{
		Name: "bifrost-marketplace",
		Owner: schemas.MarketplaceOwner{
			Name: "Bifrost",
		},
	}
}

// GetMarketplaceItemsPaginated returns paginated marketplace catalog items.
func (s *RDBConfigStore) GetMarketplaceItemsPaginated(ctx context.Context, params MarketplaceItemsQueryParams) ([]tables.TableMarketplaceItem, int64, error) {
	baseQuery := s.DB().WithContext(ctx).Model(&tables.TableMarketplaceItem{})
	if params.Search != "" {
		search := "%" + strings.ToLower(params.Search) + "%"
		baseQuery = baseQuery.Where(
			"LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(category) LIKE ?",
			search, search, search,
		)
	}
	if params.ItemType != "" {
		baseQuery = baseQuery.Where("item_type = ?", params.ItemType)
	}
	if params.Platform != "" {
		baseQuery = baseQuery.Where("platform = ?", params.Platform)
	}
	if params.Enabled != nil {
		baseQuery = baseQuery.Where("enabled = ?", *params.Enabled)
	}

	var totalCount int64
	if err := baseQuery.Count(&totalCount).Error; err != nil {
		return nil, 0, err
	}

	limit := params.Limit
	offset := params.Offset
	if limit <= 0 {
		limit = 25
	}
	if offset < 0 {
		offset = 0
	}

	var items []tables.TableMarketplaceItem
	if err := baseQuery.Order("name ASC").Limit(limit).Offset(offset).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, totalCount, nil
}

// GetMarketplaceItemByID returns a marketplace item by primary key.
func (s *RDBConfigStore) GetMarketplaceItemByID(ctx context.Context, id uint) (*tables.TableMarketplaceItem, error) {
	var item tables.TableMarketplaceItem
	if err := s.DB().WithContext(ctx).First(&item, id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

// GetMarketplaceItemByName returns a marketplace item by unique name.
func (s *RDBConfigStore) GetMarketplaceItemByName(ctx context.Context, name string) (*tables.TableMarketplaceItem, error) {
	return s.GetMarketplaceItemByNameAndPlatform(ctx, name, string(schemas.MarketplacePlatformClaude))
}

// GetMarketplaceItemByNameAndPlatform returns a marketplace item by name and platform.
func (s *RDBConfigStore) GetMarketplaceItemByNameAndPlatform(ctx context.Context, name, platform string) (*tables.TableMarketplaceItem, error) {
	name = strings.TrimSpace(name)
	platform = strings.TrimSpace(platform)
	if platform == "" {
		platform = string(schemas.MarketplacePlatformClaude)
	}
	var item tables.TableMarketplaceItem
	if err := s.DB().WithContext(ctx).Where("name = ? AND platform = ?", name, platform).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

// CreateMarketplaceItem inserts a new marketplace catalog item.
func (s *RDBConfigStore) CreateMarketplaceItem(ctx context.Context, item *tables.TableMarketplaceItem) error {
	if item == nil {
		return fmt.Errorf("marketplace item is nil")
	}
	if item.Platform == "" {
		item.Platform = schemas.MarketplacePlatformClaude
	}
	var existing tables.TableMarketplaceItem
	err := s.DB().WithContext(ctx).
		Where("name = ? AND platform = ?", strings.TrimSpace(item.Name), item.Platform).
		First(&existing).Error
	if err == nil {
		return fmt.Errorf("marketplace item %q already exists for platform %q", item.Name, item.Platform)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	now := time.Now()
	item.CreatedAt = now
	item.UpdatedAt = now
	return s.DB().WithContext(ctx).Create(item).Error
}

// UpdateMarketplaceItem updates an existing marketplace catalog item.
func (s *RDBConfigStore) UpdateMarketplaceItem(ctx context.Context, item *tables.TableMarketplaceItem) error {
	if item == nil {
		return fmt.Errorf("marketplace item is nil")
	}
	item.UpdatedAt = time.Now()
	return s.DB().WithContext(ctx).Save(item).Error
}

// DeleteMarketplaceItem removes a marketplace catalog item and its assignments.
func (s *RDBConfigStore) DeleteMarketplaceItem(ctx context.Context, id uint) error {
	return s.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("item_id = ?", id).Delete(&tables.TableMarketplaceItemAssignment{}).Error; err != nil {
			return err
		}
		if err := tx.Where("item_id = ?", id).Delete(&tables.TableMarketplaceUserAssignment{}).Error; err != nil {
			return err
		}
		result := tx.Delete(&tables.TableMarketplaceItem{}, id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

// GetMarketplaceUserAssignments returns item IDs assigned to a user (legacy user-centric API).
func (s *RDBConfigStore) GetMarketplaceUserAssignments(ctx context.Context, aoneUserID string) ([]tables.TableMarketplaceUserAssignment, error) {
	var assignments []tables.TableMarketplaceUserAssignment
	if err := s.DB().WithContext(ctx).
		Where("aone_user_id = ?", aoneUserID).
		Order("assigned_at ASC").
		Find(&assignments).Error; err != nil {
		return nil, err
	}
	return assignments, nil
}

// GetMarketplaceItemAssignments returns all assignment targets for a catalog item.
func (s *RDBConfigStore) GetMarketplaceItemAssignments(ctx context.Context, itemID uint) ([]tables.TableMarketplaceItemAssignment, error) {
	var assignments []tables.TableMarketplaceItemAssignment
	if err := s.DB().WithContext(ctx).
		Where("item_id = ?", itemID).
		Order("target_type ASC, target_id ASC").
		Find(&assignments).Error; err != nil {
		return nil, err
	}
	return assignments, nil
}

// ReplaceMarketplaceItemAssignments replaces all user and department assignments for an item.
func (s *RDBConfigStore) ReplaceMarketplaceItemAssignments(ctx context.Context, itemID uint, update *schemas.MarketplaceItemAssignmentsUpdate) error {
	if update == nil {
		update = &schemas.MarketplaceItemAssignmentsUpdate{}
	}
	return s.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("item_id = ?", itemID).Delete(&tables.TableMarketplaceItemAssignment{}).Error; err != nil {
			return err
		}
		if err := tx.Where("item_id = ?", itemID).Delete(&tables.TableMarketplaceUserAssignment{}).Error; err != nil {
			return err
		}
		now := time.Now()
		itemRows := make([]tables.TableMarketplaceItemAssignment, 0)
		legacyRows := make([]tables.TableMarketplaceUserAssignment, 0)
		for _, userID := range update.Users {
			userID = strings.TrimSpace(userID)
			if userID == "" {
				continue
			}
			itemRows = append(itemRows, tables.TableMarketplaceItemAssignment{
				ItemID:     itemID,
				TargetType: tables.MarketplaceAssignmentTargetUser,
				TargetID:   userID,
				AssignedAt: now,
			})
			legacyRows = append(legacyRows, tables.TableMarketplaceUserAssignment{
				AoneUserID: userID,
				ItemID:     itemID,
				AssignedAt: now,
			})
		}
		for _, deptID := range update.Departments {
			deptID = strings.TrimSpace(deptID)
			if deptID == "" {
				continue
			}
			itemRows = append(itemRows, tables.TableMarketplaceItemAssignment{
				ItemID:     itemID,
				TargetType: tables.MarketplaceAssignmentTargetDepartment,
				TargetID:   deptID,
				AssignedAt: now,
			})
		}
		if len(itemRows) > 0 {
			if err := tx.Create(&itemRows).Error; err != nil {
				return err
			}
		}
		if len(legacyRows) > 0 {
			if err := tx.Create(&legacyRows).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// GetMarketplaceItemsForUser returns enabled catalog items assigned directly or via department.
func (s *RDBConfigStore) GetMarketplaceItemsForUser(ctx context.Context, aoneUserID string) ([]tables.TableMarketplaceItem, error) {
	itemAssignments, err := s.getMarketplaceItemsForUserFromItemAssignments(ctx, aoneUserID)
	if err != nil {
		return nil, err
	}
	legacyItems, err := s.getMarketplaceItemsForUserFromLegacyAssignments(ctx, aoneUserID)
	if err != nil {
		return nil, err
	}
	return mergeMarketplaceItemsByID(itemAssignments, legacyItems), nil
}

func (s *RDBConfigStore) getMarketplaceItemsForUserFromItemAssignments(ctx context.Context, aoneUserID string) ([]tables.TableMarketplaceItem, error) {
	deptTargets, err := s.ExpandAoneUserDepartmentTargetIDs(ctx, aoneUserID)
	if err != nil {
		return nil, err
	}

	query := s.DB().WithContext(ctx).
		Table("marketplace_items").
		Distinct().
		Joins("JOIN marketplace_item_assignments ON marketplace_item_assignments.item_id = marketplace_items.id").
		Where("marketplace_items.enabled = ?", true)

	if len(deptTargets) > 0 {
		query = query.Where(
			"(marketplace_item_assignments.target_type = ? AND marketplace_item_assignments.target_id = ?) OR (marketplace_item_assignments.target_type = ? AND marketplace_item_assignments.target_id IN ?)",
			tables.MarketplaceAssignmentTargetUser,
			aoneUserID,
			tables.MarketplaceAssignmentTargetDepartment,
			deptTargets,
		)
	} else {
		query = query.Where(
			"marketplace_item_assignments.target_type = ? AND marketplace_item_assignments.target_id = ?",
			tables.MarketplaceAssignmentTargetUser,
			aoneUserID,
		)
	}

	var items []tables.TableMarketplaceItem
	if err := query.Order("marketplace_items.name ASC").Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (s *RDBConfigStore) getMarketplaceItemsForUserFromLegacyAssignments(ctx context.Context, aoneUserID string) ([]tables.TableMarketplaceItem, error) {
	var legacyItems []tables.TableMarketplaceItem
	err := s.DB().WithContext(ctx).
		Table("marketplace_items").
		Joins("JOIN marketplace_user_assignments ON marketplace_user_assignments.item_id = marketplace_items.id").
		Where("marketplace_user_assignments.aone_user_id = ? AND marketplace_items.enabled = ?", aoneUserID, true).
		Order("marketplace_items.name ASC").
		Find(&legacyItems).Error
	if err != nil {
		return nil, err
	}
	return legacyItems, nil
}

func mergeMarketplaceItemsByID(groups ...[]tables.TableMarketplaceItem) []tables.TableMarketplaceItem {
	seen := map[uint]struct{}{}
	merged := make([]tables.TableMarketplaceItem, 0)
	for _, group := range groups {
		for i := range group {
			if _, ok := seen[group[i].ID]; ok {
				continue
			}
			seen[group[i].ID] = struct{}{}
			merged = append(merged, group[i])
		}
	}
	return merged
}

// ReplaceMarketplaceUserAssignments replaces all assignments for a user.
func (s *RDBConfigStore) ReplaceMarketplaceUserAssignments(ctx context.Context, aoneUserID string, itemIDs []uint) error {
	return s.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("aone_user_id = ?", aoneUserID).Delete(&tables.TableMarketplaceUserAssignment{}).Error; err != nil {
			return err
		}
		if len(itemIDs) == 0 {
			return nil
		}
		now := time.Now()
		rows := make([]tables.TableMarketplaceUserAssignment, 0, len(itemIDs))
		for _, itemID := range itemIDs {
			rows = append(rows, tables.TableMarketplaceUserAssignment{
				AoneUserID: aoneUserID,
				ItemID:     itemID,
				AssignedAt: now,
			})
		}
		return tx.Create(&rows).Error
	})
}

// AddMarketplaceUserAssignments adds assignments without removing existing ones.
func (s *RDBConfigStore) AddMarketplaceUserAssignments(ctx context.Context, aoneUserID string, itemIDs []uint) error {
	if len(itemIDs) == 0 {
		return nil
	}
	now := time.Now()
	return s.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, itemID := range itemIDs {
			row := tables.TableMarketplaceUserAssignment{
				AoneUserID: aoneUserID,
				ItemID:     itemID,
				AssignedAt: now,
			}
			if err := tx.
				Where("aone_user_id = ? AND item_id = ?", aoneUserID, itemID).
				FirstOrCreate(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// RemoveMarketplaceUserAssignment removes a single assignment.
func (s *RDBConfigStore) RemoveMarketplaceUserAssignment(ctx context.Context, aoneUserID string, itemID uint) error {
	result := s.DB().WithContext(ctx).
		Where("aone_user_id = ? AND item_id = ?", aoneUserID, itemID).
		Delete(&tables.TableMarketplaceUserAssignment{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// BuildMarketplaceManifest builds a Claude Code compatible manifest from catalog items.
func BuildMarketplaceManifest(cfg *schemas.MarketplaceConfig, items []tables.TableMarketplaceItem) *schemas.MarketplaceManifest {
	if cfg == nil {
		cfg = defaultMarketplaceConfig()
	}
	manifest := &schemas.MarketplaceManifest{
		Name:  cfg.Name,
		Owner: cfg.Owner,
	}
	for i := range items {
		item := items[i]
		if !item.Enabled || normalizeMarketplacePlatform(item.Platform) != schemas.MarketplacePlatformClaude {
			continue
		}
		source := strings.TrimSpace(item.Source)
		if source == "" {
			source = defaultMarketplaceSource(item)
		}
		manifest.Plugins = append(manifest.Plugins, schemas.MarketplaceManifestEntry{
			Name:        item.Name,
			Source:      source,
			Description: item.Description,
			Version:     item.Version,
		})
	}
	return manifest
}

// BuildCodexMarketplaceManifest builds a Codex CLI compatible manifest from catalog items.
func BuildCodexMarketplaceManifest(cfg *schemas.MarketplaceConfig, items []tables.TableMarketplaceItem) *schemas.CodexMarketplaceManifest {
	if cfg == nil {
		cfg = defaultMarketplaceConfig()
	}
	manifest := &schemas.CodexMarketplaceManifest{
		Name: cfg.Name,
		Interface: &schemas.CodexMarketplaceInterface{
			DisplayName: cfg.Owner.Name,
		},
	}
	if strings.TrimSpace(manifest.Interface.DisplayName) == "" {
		manifest.Interface.DisplayName = cfg.Name
	}
	for i := range items {
		item := items[i]
		if !item.Enabled || normalizeMarketplacePlatform(item.Platform) != schemas.MarketplacePlatformCodex {
			continue
		}
		source := strings.TrimSpace(item.Source)
		if source == "" {
			source = defaultMarketplaceSource(item)
		}
		displayName := item.Name
		if item.Content != nil && item.Content.PluginJSON != nil {
			if iface, ok := item.Content.PluginJSON["interface"].(map[string]any); ok {
				if value := stringFieldFromAny(iface["displayName"]); value != "" {
					displayName = value
				}
			}
		}
		category := strings.TrimSpace(item.Category)
		if category == "" {
			category = defaultCodexCategory(item.ItemType)
		}
		manifest.Plugins = append(manifest.Plugins, schemas.CodexMarketplacePluginEntry{
			Name:        item.Name,
			DisplayName: displayName,
			Source: schemas.CodexMarketplaceSourceRef{
				Source: "local",
				Path:   source,
			},
			Policy: schemas.CodexMarketplacePolicy{
				Installation:   "AVAILABLE",
				Authentication: "ON_INSTALL",
			},
			Category:    category,
			Description: item.Description,
		})
	}
	return manifest
}

func normalizeMarketplacePlatform(platform schemas.MarketplacePlatform) schemas.MarketplacePlatform {
	if platform == schemas.MarketplacePlatformCodex {
		return schemas.MarketplacePlatformCodex
	}
	return schemas.MarketplacePlatformClaude
}

func defaultCodexCategory(itemType schemas.MarketplaceItemType) string {
	if itemType == schemas.MarketplaceItemTypeSkill {
		return "Skills"
	}
	return "Plugins"
}

func stringFieldFromAny(raw any) string {
	if raw == nil {
		return ""
	}
	switch v := raw.(type) {
	case string:
		return strings.TrimSpace(v)
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func defaultMarketplaceSource(item tables.TableMarketplaceItem) string {
	platformSegment := "claude"
	if normalizeMarketplacePlatform(item.Platform) == schemas.MarketplacePlatformCodex {
		platformSegment = "codex"
	}
	switch item.ItemType {
	case schemas.MarketplaceItemTypeSkill:
		return fmt.Sprintf("./marketplace/%s/skills/%s", platformSegment, item.Name)
	default:
		return fmt.Sprintf("./marketplace/%s/plugins/%s", platformSegment, item.Name)
	}
}

func jsonMarshal(v any) ([]byte, error) {
	return json.Marshal(v)
}

func jsonUnmarshal(data []byte, v any) error {
	return json.Unmarshal(data, v)
}
