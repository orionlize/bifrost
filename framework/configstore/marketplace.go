package configstore

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
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
	patch := map[string]any{marketplaceMetadataKey: cfg}
	return s.UpdateClientMetadata(ctx, patch)
}

func defaultMarketplaceConfig() *schemas.MarketplaceConfig {
	return &schemas.MarketplaceConfig{
		Name: "bifrost-marketplace",
		Owner: schemas.MarketplaceOwner{
			Name: "Bifrost",
		},
		PublicRead: true,
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
	var item tables.TableMarketplaceItem
	if err := s.DB().WithContext(ctx).Where("name = ?", name).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

// CreateMarketplaceItem inserts a new marketplace catalog item.
func (s *RDBConfigStore) CreateMarketplaceItem(ctx context.Context, item *tables.TableMarketplaceItem) error {
	if item == nil {
		return fmt.Errorf("marketplace item is nil")
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

// DeleteMarketplaceItem removes a marketplace catalog item and its user assignments.
func (s *RDBConfigStore) DeleteMarketplaceItem(ctx context.Context, id uint) error {
	return s.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
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

// GetMarketplaceUserAssignments returns item IDs assigned to a user.
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

// GetMarketplaceItemsForUser returns enabled catalog items assigned to a user.
func (s *RDBConfigStore) GetMarketplaceItemsForUser(ctx context.Context, aoneUserID string) ([]tables.TableMarketplaceItem, error) {
	var items []tables.TableMarketplaceItem
	err := s.DB().WithContext(ctx).
		Table("marketplace_items").
		Joins("JOIN marketplace_user_assignments ON marketplace_user_assignments.item_id = marketplace_items.id").
		Where("marketplace_user_assignments.aone_user_id = ? AND marketplace_items.enabled = ?", aoneUserID, true).
		Order("marketplace_items.name ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
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
		if !item.Enabled {
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

func defaultMarketplaceSource(item tables.TableMarketplaceItem) string {
	switch item.ItemType {
	case schemas.MarketplaceItemTypeSkill:
		return fmt.Sprintf("./marketplace/skills/%s", item.Name)
	default:
		return fmt.Sprintf("./marketplace/plugins/%s", item.Name)
	}
}

func jsonMarshal(v any) ([]byte, error) {
	return json.Marshal(v)
}

func jsonUnmarshal(data []byte, v any) error {
	return json.Unmarshal(data, v)
}
