package tables

import "time"

const (
	AoneDeviceCredentialStatusActive  = "active"
	AoneDeviceCredentialStatusRevoked = "revoked"
)

// AoneDeviceCredentialTable stores short-lived (24h) forwarding credentials
// issued to a desktop client after it exchanges a device authorization code.
// The credential is the only AI-forwarding credential a user presents: it is
// device-bound (fingerprint), time-bound (ExpiresAt), and resolves to the
// owning user's internal virtual key for governance. Only the hash is
// persisted; the plaintext is returned once at issuance time and never stored.
type AoneDeviceCredentialTable struct {
	ID                    int        `gorm:"primaryKey;autoIncrement" json:"-"`
	CredentialHash        string     `gorm:"column:credential_hash;type:varchar(64);not null;uniqueIndex" json:"-"`
	CredentialPrefix      string     `gorm:"column:credential_prefix;type:varchar(32);not null" json:"credential_prefix"`
	AoneUserID            string     `gorm:"column:aone_user_id;type:varchar(255);not null;index" json:"aone_user_id"`
	DeviceAuthorizationID int        `gorm:"column:device_authorization_id;not null;index" json:"device_authorization_id"`
	DeviceFingerprint     string     `gorm:"column:device_fingerprint;type:varchar(512);not null;index" json:"device_fingerprint"`
	VirtualKeyID          string     `gorm:"column:virtual_key_id;type:varchar(255);not null" json:"-"`
	Status                string     `gorm:"column:status;type:varchar(32);not null;default:'active';index" json:"status"`
	LastUsedAt            *time.Time `gorm:"column:last_used_at;index" json:"last_used_at,omitempty"`
	ExpiresAt             time.Time  `gorm:"column:expires_at;index;not null" json:"expires_at"`
	CreatedAt             time.Time  `gorm:"index;not null" json:"created_at"`
	UpdatedAt             time.Time  `gorm:"index;not null" json:"updated_at"`
	RevokedAt             *time.Time `gorm:"index" json:"revoked_at,omitempty"`
}

func (AoneDeviceCredentialTable) TableName() string { return "aone_device_credentials" }
