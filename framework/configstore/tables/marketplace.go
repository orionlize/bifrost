package tables

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"gorm.io/gorm"
)

// TableMarketplaceItem is a unified catalog entry for a skill or plugin bundle.
type TableMarketplaceItem struct {
	ID          uint                       `gorm:"primaryKey;autoIncrement" json:"id"`
	Name        string                     `gorm:"type:varchar(255);not null;uniqueIndex" json:"name"`
	ItemType    schemas.MarketplaceItemType `gorm:"type:varchar(20);not null;index" json:"item_type"`
	Description string                     `gorm:"type:text" json:"description"`
	Version     string                     `gorm:"type:varchar(64)" json:"version"`
	Source      string                     `gorm:"type:varchar(512);not null" json:"source"`
	Enabled     bool                       `gorm:"not null;default:true;index" json:"enabled"`
	Category    string                     `gorm:"type:varchar(128)" json:"category,omitempty"`
	TagsJSON    string                     `gorm:"column:tags_json;type:text" json:"-"`
	ContentJSON string                     `gorm:"column:content_json;type:text" json:"-"`
	CreatedAt   time.Time                  `gorm:"index;not null" json:"created_at"`
	UpdatedAt   time.Time                  `gorm:"index;not null" json:"updated_at"`

	Tags    []string                    `gorm:"-" json:"tags,omitempty"`
	Content *schemas.MarketplaceItemBundle `gorm:"-" json:"content,omitempty"`
}

// TableName sets the table name for TableMarketplaceItem.
func (TableMarketplaceItem) TableName() string { return "marketplace_items" }

// BeforeSave serializes tags and content JSON before writing to the database.
func (item *TableMarketplaceItem) BeforeSave(tx *gorm.DB) error {
	if len(item.Tags) > 0 {
		data, err := json.Marshal(item.Tags)
		if err != nil {
			return err
		}
		item.TagsJSON = string(data)
	} else {
		item.TagsJSON = "[]"
	}

	if item.Content != nil {
		data, err := json.Marshal(item.Content)
		if err != nil {
			return err
		}
		item.ContentJSON = string(data)
	} else {
		item.ContentJSON = "{}"
	}
	return nil
}

// AfterFind deserializes tags and content JSON after reading from the database.
func (item *TableMarketplaceItem) AfterFind(tx *gorm.DB) error {
	if item.TagsJSON != "" {
		if err := json.Unmarshal([]byte(item.TagsJSON), &item.Tags); err != nil {
			return fmt.Errorf("unmarshal marketplace item tags: %w", err)
		}
	}
	if item.ContentJSON != "" && item.ContentJSON != "{}" {
		var bundle schemas.MarketplaceItemBundle
		if err := json.Unmarshal([]byte(item.ContentJSON), &bundle); err != nil {
			return fmt.Errorf("unmarshal marketplace item content: %w", err)
		}
		item.Content = &bundle
	}
	return nil
}

// TableMarketplaceUserAssignment links an Aone user to a catalog item.
type TableMarketplaceUserAssignment struct {
	ID         uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	AoneUserID string    `gorm:"column:aone_user_id;type:varchar(255);not null;uniqueIndex:idx_marketplace_user_item" json:"aone_user_id"`
	ItemID     uint      `gorm:"not null;uniqueIndex:idx_marketplace_user_item;index" json:"item_id"`
	AssignedAt time.Time `gorm:"index;not null" json:"assigned_at"`
}

// TableName sets the table name for TableMarketplaceUserAssignment.
func (TableMarketplaceUserAssignment) TableName() string { return "marketplace_user_assignments" }
