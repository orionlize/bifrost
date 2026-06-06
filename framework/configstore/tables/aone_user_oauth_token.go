package tables

import (
	"fmt"
	"time"

	"github.com/maximhq/bifrost/framework/encrypt"
	"gorm.io/gorm"
)

// AoneUserOAuthTokenTable stores Aone OAuth2 tokens obtained during source-scoped login flows
// (e.g. /login?source=zwitch).
type AoneUserOAuthTokenTable struct {
	ID               int        `gorm:"primaryKey;autoIncrement" json:"-"`
	AoneUserID         string `gorm:"column:aone_user_id;type:varchar(255);not null;uniqueIndex:idx_aone_user_oauth_token_scope,priority:1" json:"aone_user_id"`
	LoginSource        string `gorm:"column:login_source;type:varchar(64);not null;uniqueIndex:idx_aone_user_oauth_token_scope,priority:2;index" json:"login_source"`
	SessionTokenHash   string `gorm:"column:session_token_hash;type:varchar(64);not null;default:'';uniqueIndex:idx_aone_user_oauth_token_scope,priority:3" json:"-"`
	AccessToken      string     `gorm:"type:text;not null" json:"-"`
	RefreshToken     string     `gorm:"type:text" json:"-"`
	TokenType        string     `gorm:"type:varchar(50);not null;default:'Bearer'" json:"token_type"`
	ExpiresAt        *time.Time `gorm:"index" json:"expires_at,omitempty"`
	LastRefreshedAt  *time.Time `gorm:"index" json:"last_refreshed_at,omitempty"`
	EncryptionStatus string     `gorm:"type:varchar(20);default:'plain_text'" json:"-"`
	CreatedAt        time.Time  `gorm:"index;not null" json:"created_at"`
	UpdatedAt        time.Time  `gorm:"index;not null" json:"updated_at"`
}

// TableName sets the table name for the model.
func (AoneUserOAuthTokenTable) TableName() string { return "aone_user_oauth_tokens" }

// BeforeSave encrypts sensitive token fields at rest.
func (t *AoneUserOAuthTokenTable) BeforeSave(tx *gorm.DB) error {
	if t.TokenType == "" {
		t.TokenType = "Bearer"
	}
	if encrypt.IsEnabled() {
		if err := encryptString(&t.AccessToken); err != nil {
			return fmt.Errorf("failed to encrypt aone user oauth access token: %w", err)
		}
		if t.RefreshToken != "" {
			if err := encryptString(&t.RefreshToken); err != nil {
				return fmt.Errorf("failed to encrypt aone user oauth refresh token: %w", err)
			}
		}
		t.EncryptionStatus = EncryptionStatusEncrypted
	}
	return nil
}

// AfterFind decrypts sensitive token fields after load.
func (t *AoneUserOAuthTokenTable) AfterFind(tx *gorm.DB) error {
	if t.EncryptionStatus == EncryptionStatusEncrypted {
		if err := decryptString(&t.AccessToken); err != nil {
			return fmt.Errorf("failed to decrypt aone user oauth access token: %w", err)
		}
		if t.RefreshToken != "" {
			if err := decryptString(&t.RefreshToken); err != nil {
				return fmt.Errorf("failed to decrypt aone user oauth refresh token: %w", err)
			}
		}
	}
	return nil
}
