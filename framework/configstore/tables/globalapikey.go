package tables

import "time"

// GlobalAPIKey stores a dashboard/admin API key. Only the hash is persisted;
// the plaintext token is returned once at creation time.
type GlobalAPIKey struct {
	ID              string    `gorm:"type:varchar(255);primaryKey" json:"id"`
	Name            string    `gorm:"type:varchar(255);not null" json:"name"`
	TokenHash       string    `gorm:"type:varchar(64);uniqueIndex:idx_global_api_key_hash;not null" json:"-"`
	TokenEncrypted  string    `gorm:"type:text" json:"-"`
	TokenPrefix     string    `gorm:"type:varchar(32);not null" json:"token_prefix"`
	IsActive        bool      `gorm:"not null;default:true;index" json:"is_active"`
	AllowedUserIDs  []string  `gorm:"type:text;serializer:json" json:"allowed_user_ids,omitempty"`
	CreatedAt       time.Time `gorm:"index;not null" json:"created_at"`
	UpdatedAt       time.Time `gorm:"index;not null" json:"updated_at"`
}

func (GlobalAPIKey) TableName() string { return "global_api_keys" }
