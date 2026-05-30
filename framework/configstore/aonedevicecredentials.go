package configstore

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"gorm.io/gorm"
)

// AoneDeviceCredentialPrefix is the prefix carried by device-issued temporary
// forwarding credentials. It is intentionally distinct from the governance
// virtual key prefix (sk-bf-) and the admin global API key prefix (bf-ak-) so
// the auth middleware can tell them apart by inspection.
const AoneDeviceCredentialPrefix = "bf-tmp-"

// DefaultAoneDeviceCredentialTTL is the lifetime of a device-issued temporary
// forwarding credential. When it lapses the client must re-exchange its device
// authorization code for a fresh credential.
const DefaultAoneDeviceCredentialTTL = 24 * time.Hour

var (
	ErrDeviceCredentialNotFound = errors.New("device credential not found")
	ErrDeviceCredentialExpired  = errors.New("device credential expired")
)

func generateAoneDeviceCredentialToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("failed to generate device credential token: %w", err)
	}
	return AoneDeviceCredentialPrefix + hex.EncodeToString(buf), nil
}

func aoneDeviceCredentialPrefix(token string) string {
	if len(token) <= 14 {
		return token
	}
	return token[:14] + "..."
}

// CreateAoneDeviceTemporaryCredential issues a fresh 24h forwarding credential
// for a verified (user, device) pair. Any existing active credentials for the
// same device are revoked first so a device only ever has one live credential.
func (s *RDBConfigStore) CreateAoneDeviceTemporaryCredential(
	ctx context.Context,
	aoneUserID string,
	deviceAuthorizationID int,
	deviceFingerprint string,
	virtualKeyID string,
	ttl time.Duration,
) (token string, expiresAt time.Time, err error) {
	aoneUserID = strings.TrimSpace(aoneUserID)
	deviceFingerprint = strings.TrimSpace(deviceFingerprint)
	virtualKeyID = strings.TrimSpace(virtualKeyID)
	if aoneUserID == "" || deviceFingerprint == "" || virtualKeyID == "" || deviceAuthorizationID <= 0 {
		return "", time.Time{}, gorm.ErrRecordNotFound
	}
	if ttl <= 0 {
		ttl = DefaultAoneDeviceCredentialTTL
	}

	token, err = generateAoneDeviceCredentialToken()
	if err != nil {
		return "", time.Time{}, err
	}

	now := time.Now()
	expiresAt = now.Add(ttl)
	row := tables.AoneDeviceCredentialTable{
		CredentialHash:        encrypt.HashSHA256(token),
		CredentialPrefix:      aoneDeviceCredentialPrefix(token),
		AoneUserID:            aoneUserID,
		DeviceAuthorizationID: deviceAuthorizationID,
		DeviceFingerprint:     deviceFingerprint,
		VirtualKeyID:          virtualKeyID,
		Status:                tables.AoneDeviceCredentialStatusActive,
		ExpiresAt:             expiresAt,
		CreatedAt:             now,
		UpdatedAt:             now,
	}

	err = s.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		tx = tx.WithContext(ctx)
		if revokeErr := tx.Model(&tables.AoneDeviceCredentialTable{}).
			Where("device_authorization_id = ? AND status = ?", deviceAuthorizationID, tables.AoneDeviceCredentialStatusActive).
			Updates(map[string]any{
				"status":     tables.AoneDeviceCredentialStatusRevoked,
				"revoked_at": now,
				"updated_at": now,
			}).Error; revokeErr != nil {
			return revokeErr
		}
		return tx.Create(&row).Error
	})
	if err != nil {
		return "", time.Time{}, err
	}
	return token, expiresAt, nil
}

// ResolveActiveAoneDeviceTemporaryCredential loads an active, unexpired
// credential by its plaintext token. It returns ErrDeviceCredentialNotFound
// when no active row matches and ErrDeviceCredentialExpired when the matched
// row has lapsed.
func (s *RDBConfigStore) ResolveActiveAoneDeviceTemporaryCredential(ctx context.Context, token string) (*tables.AoneDeviceCredentialTable, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, ErrDeviceCredentialNotFound
	}

	var row tables.AoneDeviceCredentialTable
	err := s.DB().WithContext(ctx).
		Where("credential_hash = ? AND status = ?", encrypt.HashSHA256(token), tables.AoneDeviceCredentialStatusActive).
		First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDeviceCredentialNotFound
		}
		return nil, err
	}
	if !row.ExpiresAt.After(time.Now()) {
		return nil, ErrDeviceCredentialExpired
	}
	return &row, nil
}

// RevokeAoneDeviceTemporaryCredentialsForUser invalidates every active
// credential for an Aone user (disable, logout, admin action).
func (s *RDBConfigStore) RevokeAoneDeviceTemporaryCredentialsForUser(ctx context.Context, aoneUserID string) error {
	aoneUserID = strings.TrimSpace(aoneUserID)
	if aoneUserID == "" {
		return nil
	}
	now := time.Now()
	return s.DB().WithContext(ctx).
		Model(&tables.AoneDeviceCredentialTable{}).
		Where("aone_user_id = ? AND status = ?", aoneUserID, tables.AoneDeviceCredentialStatusActive).
		Updates(map[string]any{
			"status":     tables.AoneDeviceCredentialStatusRevoked,
			"revoked_at": now,
			"updated_at": now,
		}).Error
}

// RevokeAoneDeviceTemporaryCredentialsForDevice invalidates every active
// credential issued for a specific device authorization (device revoke).
func (s *RDBConfigStore) RevokeAoneDeviceTemporaryCredentialsForDevice(ctx context.Context, deviceAuthorizationID int) error {
	if deviceAuthorizationID <= 0 {
		return nil
	}
	now := time.Now()
	return s.DB().WithContext(ctx).
		Model(&tables.AoneDeviceCredentialTable{}).
		Where("device_authorization_id = ? AND status = ?", deviceAuthorizationID, tables.AoneDeviceCredentialStatusActive).
		Updates(map[string]any{
			"status":     tables.AoneDeviceCredentialStatusRevoked,
			"revoked_at": now,
			"updated_at": now,
		}).Error
}

// TouchAoneDeviceTemporaryCredentialLastUsed records the latest forwarding use.
func (s *RDBConfigStore) TouchAoneDeviceTemporaryCredentialLastUsed(ctx context.Context, id int) error {
	if id <= 0 {
		return nil
	}
	now := time.Now()
	return s.DB().WithContext(ctx).
		Model(&tables.AoneDeviceCredentialTable{}).
		Where("id = ? AND status = ?", id, tables.AoneDeviceCredentialStatusActive).
		Updates(map[string]any{
			"last_used_at": now,
			"updated_at":   now,
		}).Error
}

// DeleteExpiredAoneDeviceTemporaryCredentials removes credential rows whose
// expires_at is at or before `before`. Returns the number of rows removed.
func (s *RDBConfigStore) DeleteExpiredAoneDeviceTemporaryCredentials(ctx context.Context, before time.Time) (int64, error) {
	result := s.DB().WithContext(ctx).
		Where("expires_at <= ?", before).
		Delete(&tables.AoneDeviceCredentialTable{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}
