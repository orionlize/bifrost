package tables

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/encrypt"
	"gorm.io/gorm"
)

// TableMarketplaceItem is a unified catalog entry for a skill or plugin bundle.
type TableMarketplaceItem struct {
	ID            uint                       `gorm:"primaryKey;autoIncrement" json:"id"`
	Name          string                     `gorm:"type:varchar(255);not null;uniqueIndex:idx_marketplace_name_platform" json:"name"`
	Platform      schemas.MarketplacePlatform `gorm:"type:varchar(20);not null;default:claude;index;uniqueIndex:idx_marketplace_name_platform" json:"platform"`
	ItemType      schemas.MarketplaceItemType `gorm:"type:varchar(20);not null;index" json:"item_type"`
	Description string                     `gorm:"type:text" json:"description"`
	Version     string                     `gorm:"type:varchar(64)" json:"version"`
	Source      string                          `gorm:"type:varchar(512);not null" json:"source"`
	SourceType  schemas.MarketplaceImportSourceType `gorm:"type:varchar(20);not null;default:zip" json:"source_type"`
	RemoteURL   string                          `gorm:"type:varchar(1024)" json:"remote_url,omitempty"`
	RemoteRef   string                          `gorm:"type:varchar(255)" json:"remote_ref,omitempty"`
	IconURL     string                          `gorm:"type:varchar(2048)" json:"icon_url,omitempty"`
	IconData    string                          `gorm:"column:icon_data;type:text" json:"-"`
	IconMediaType string                        `gorm:"column:icon_media_type;type:varchar(64)" json:"icon_media_type,omitempty"`
	Enabled     bool                            `gorm:"not null;default:true;index" json:"enabled"`
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
// Deprecated: use TableMarketplaceItemAssignment instead. Kept for migration compatibility.
type TableMarketplaceUserAssignment struct {
	ID         uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	AoneUserID string    `gorm:"column:aone_user_id;type:varchar(255);not null;uniqueIndex:idx_marketplace_user_item" json:"aone_user_id"`
	ItemID     uint      `gorm:"not null;uniqueIndex:idx_marketplace_user_item;index" json:"item_id"`
	AssignedAt time.Time `gorm:"index;not null" json:"assigned_at"`
}

// TableName sets the table name for TableMarketplaceUserAssignment.
func (TableMarketplaceUserAssignment) TableName() string { return "marketplace_user_assignments" }

// MarketplaceAssignmentTargetType identifies assignment targets for catalog items.
type MarketplaceAssignmentTargetType string

const (
	MarketplaceAssignmentTargetUser       MarketplaceAssignmentTargetType = "user"
	MarketplaceAssignmentTargetDepartment MarketplaceAssignmentTargetType = "department"
)

// TableMarketplaceItemAssignment links a catalog item to a user or department.
type TableMarketplaceItemAssignment struct {
	ID         uint                            `gorm:"primaryKey;autoIncrement" json:"id"`
	ItemID     uint                            `gorm:"not null;uniqueIndex:idx_marketplace_item_target;index" json:"item_id"`
	TargetType MarketplaceAssignmentTargetType `gorm:"column:target_type;type:varchar(20);not null;uniqueIndex:idx_marketplace_item_target" json:"target_type"`
	TargetID   string                          `gorm:"column:target_id;type:varchar(255);not null;uniqueIndex:idx_marketplace_item_target;index" json:"target_id"`
	AssignedAt time.Time                       `gorm:"index;not null" json:"assigned_at"`
}

// TableName sets the table name for TableMarketplaceItemAssignment.
func (TableMarketplaceItemAssignment) TableName() string { return "marketplace_item_assignments" }

// TableMarketplaceUserCredentials stores per-user GitHub/GitLab tokens for marketplace imports.
type TableMarketplaceUserCredentials struct {
	ID               uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	OwnerID          string    `gorm:"column:owner_id;type:varchar(255);not null;uniqueIndex" json:"owner_id"`
	GitHubToken      string    `gorm:"column:github_token;type:text" json:"-"`
	GitLabToken      string    `gorm:"column:gitlab_token;type:text" json:"-"`
	EncryptionStatus string    `gorm:"type:varchar(20);default:'plain_text'" json:"-"`
	CreatedAt        time.Time `gorm:"index;not null" json:"created_at"`
	UpdatedAt        time.Time `gorm:"index;not null" json:"updated_at"`
}

// TableName sets the table name for TableMarketplaceUserCredentials.
func (TableMarketplaceUserCredentials) TableName() string { return "marketplace_user_credentials" }

// BeforeSave encrypts token fields when encryption is enabled.
func (c *TableMarketplaceUserCredentials) BeforeSave(tx *gorm.DB) error {
	if encrypt.IsEnabled() {
		if c.GitHubToken != "" {
			if err := encryptString(&c.GitHubToken); err != nil {
				return fmt.Errorf("encrypt marketplace github token: %w", err)
			}
		}
		if c.GitLabToken != "" {
			if err := encryptString(&c.GitLabToken); err != nil {
				return fmt.Errorf("encrypt marketplace gitlab token: %w", err)
			}
		}
		if c.GitHubToken != "" || c.GitLabToken != "" {
			c.EncryptionStatus = EncryptionStatusEncrypted
		}
	}
	return nil
}

// AfterFind decrypts token fields when the row is marked encrypted.
func (c *TableMarketplaceUserCredentials) AfterFind(tx *gorm.DB) error {
	if c.EncryptionStatus != EncryptionStatusEncrypted {
		return nil
	}
	if c.GitHubToken != "" {
		if err := decryptString(&c.GitHubToken); err != nil {
			return fmt.Errorf("decrypt marketplace github token: %w", err)
		}
	}
	if c.GitLabToken != "" {
		if err := decryptString(&c.GitLabToken); err != nil {
			return fmt.Errorf("decrypt marketplace gitlab token: %w", err)
		}
	}
	return nil
}
