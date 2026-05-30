package tables

import (
	"fmt"
	"time"

	"github.com/maximhq/bifrost/framework/encrypt"
	"gorm.io/gorm"
)

const (
	AoneDeviceAuthorizationStatusActive  = "active"
	AoneDeviceAuthorizationStatusRevoked = "revoked"
)

// AoneDeviceAuthorizationTable binds a persistent desktop authorization code to
// an Aone user and a device fingerprint (ZD Switch and similar clients).
type AoneDeviceAuthorizationTable struct {
	ID                    int        `gorm:"primaryKey;autoIncrement" json:"-"`
	AuthorizationCode     string     `gorm:"column:authorization_code;type:text;not null" json:"-"`
	AuthorizationCodeHash string     `gorm:"column:authorization_code_hash;type:varchar(64);not null;uniqueIndex" json:"-"`
	DeviceFingerprint     string     `gorm:"column:device_fingerprint;type:varchar(255);not null;uniqueIndex:idx_aone_device_auth_user_fingerprint,priority:2" json:"device_fingerprint"`
	AoneUserID            string     `gorm:"column:aone_user_id;type:varchar(255);not null;index;uniqueIndex:idx_aone_device_auth_user_fingerprint,priority:1" json:"aone_user_id"`
	DeviceName            string     `gorm:"column:device_name;type:varchar(255)" json:"device_name"`
	Status                string     `gorm:"column:status;type:varchar(32);not null;default:'active';index" json:"status"`
	LastAPIAccessAt       *time.Time `gorm:"column:last_api_access_at;index" json:"last_api_access_at,omitempty"`
	EncryptionStatus      string     `gorm:"type:varchar(20);default:'plain_text'" json:"-"`
	CreatedAt             time.Time  `gorm:"index;not null" json:"created_at"`
	UpdatedAt             time.Time  `gorm:"index;not null" json:"updated_at"`
	RevokedAt             *time.Time `gorm:"index" json:"revoked_at,omitempty"`
}

func (AoneDeviceAuthorizationTable) TableName() string { return "aone_device_authorizations" }

func (r *AoneDeviceAuthorizationTable) BeforeSave(tx *gorm.DB) error {
	if r.AuthorizationCode != "" {
		r.AuthorizationCodeHash = encrypt.HashSHA256(r.AuthorizationCode)
	}
	if r.Status == "" {
		r.Status = AoneDeviceAuthorizationStatusActive
	}
	if encrypt.IsEnabled() && r.AuthorizationCode != "" {
		if err := encryptString(&r.AuthorizationCode); err != nil {
			return fmt.Errorf("failed to encrypt device authorization code: %w", err)
		}
		r.EncryptionStatus = EncryptionStatusEncrypted
	}
	return nil
}

func (r *AoneDeviceAuthorizationTable) AfterFind(tx *gorm.DB) error {
	if r.EncryptionStatus == EncryptionStatusEncrypted {
		if err := decryptString(&r.AuthorizationCode); err != nil {
			return fmt.Errorf("failed to decrypt device authorization code: %w", err)
		}
	}
	return nil
}
