package configstore

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"gorm.io/gorm"
)

var (
	ErrDeviceAuthorizationNotFound = errors.New("device authorization not found")
	ErrDeviceAuthorizationRevoked  = errors.New("device authorization revoked")
	ErrDeviceFingerprintMismatch   = errors.New("device fingerprint mismatch")
)

const aoneDeviceAuthorizationCodePrefix = "advc_"

// UpsertAoneDeviceAuthorization registers or refreshes a persistent authorization
// code for an Aone user + device fingerprint pair (idempotent per device).
func (s *RDBConfigStore) UpsertAoneDeviceAuthorization(
	ctx context.Context,
	aoneUserID, deviceFingerprint, deviceName string,
) (authorizationCode string, err error) {
	aoneUserID = strings.TrimSpace(aoneUserID)
	deviceFingerprint = strings.TrimSpace(deviceFingerprint)
	deviceName = strings.TrimSpace(deviceName)
	if aoneUserID == "" || deviceFingerprint == "" {
		return "", gorm.ErrRecordNotFound
	}

	now := time.Now()
	code := aoneDeviceAuthorizationCodePrefix + uuid.NewString()

	var existing tables.AoneDeviceAuthorizationTable
	err = s.DB().WithContext(ctx).
		Where("aone_user_id = ? AND device_fingerprint = ?", aoneUserID, deviceFingerprint).
		First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		row := tables.AoneDeviceAuthorizationTable{
			AuthorizationCode: code,
			DeviceFingerprint: deviceFingerprint,
			AoneUserID:        aoneUserID,
			DeviceName:        deviceName,
			Status:            tables.AoneDeviceAuthorizationStatusActive,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		if err := s.DB().WithContext(ctx).Create(&row).Error; err != nil {
			return "", err
		}
		return code, nil
	}
	if err != nil {
		return "", err
	}

	existing.AuthorizationCode = code
	existing.DeviceName = deviceName
	existing.Status = tables.AoneDeviceAuthorizationStatusActive
	existing.RevokedAt = nil
	existing.UpdatedAt = now
	if err := s.DB().WithContext(ctx).Save(&existing).Error; err != nil {
		return "", err
	}
	return code, nil
}

// GetActiveAoneDeviceAuthorizationForUsers loads an active device authorization
// matching the given fingerprint for any of the supplied Aone users. It is used
// to gate API forwarding requests by device fingerprint: a global API key maps
// to one or more Aone users, and the caller's device fingerprint must match an
// active device belonging to one of those users.
func (s *RDBConfigStore) GetActiveAoneDeviceAuthorizationForUsers(ctx context.Context, aoneUserIDs []string, deviceFingerprint string) (*tables.AoneDeviceAuthorizationTable, error) {
	deviceFingerprint = strings.TrimSpace(deviceFingerprint)
	if deviceFingerprint == "" || len(aoneUserIDs) == 0 {
		return nil, ErrDeviceAuthorizationNotFound
	}

	var row tables.AoneDeviceAuthorizationTable
	err := s.DB().WithContext(ctx).
		Where("aone_user_id IN ? AND device_fingerprint = ? AND status = ?",
			aoneUserIDs, deviceFingerprint, tables.AoneDeviceAuthorizationStatusActive).
		First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDeviceAuthorizationNotFound
		}
		return nil, err
	}
	return &row, nil
}

// GetActiveAoneDeviceAuthorizationByCode loads an active authorization by code.
func (s *RDBConfigStore) GetActiveAoneDeviceAuthorizationByCode(ctx context.Context, authorizationCode string) (*tables.AoneDeviceAuthorizationTable, error) {
	authorizationCode = strings.TrimSpace(authorizationCode)
	if authorizationCode == "" {
		return nil, ErrDeviceAuthorizationNotFound
	}

	var row tables.AoneDeviceAuthorizationTable
	codeHash := encrypt.HashSHA256(authorizationCode)
	err := s.DB().WithContext(ctx).Where("authorization_code_hash = ?", codeHash).First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDeviceAuthorizationNotFound
		}
		return nil, err
	}
	if row.Status != tables.AoneDeviceAuthorizationStatusActive {
		return nil, ErrDeviceAuthorizationRevoked
	}
	return &row, nil
}

// RevokeAoneDeviceAuthorization invalidates a device authorization code when the
// fingerprint matches. Missing rows are treated as success.
func (s *RDBConfigStore) RevokeAoneDeviceAuthorization(ctx context.Context, authorizationCode, deviceFingerprint string) error {
	authorizationCode = strings.TrimSpace(authorizationCode)
	deviceFingerprint = strings.TrimSpace(deviceFingerprint)
	if authorizationCode == "" {
		return nil
	}

	row, err := s.GetActiveAoneDeviceAuthorizationByCode(ctx, authorizationCode)
	if err != nil {
		if errors.Is(err, ErrDeviceAuthorizationNotFound) || errors.Is(err, ErrDeviceAuthorizationRevoked) {
			return nil
		}
		return err
	}
	if deviceFingerprint != "" && row.DeviceFingerprint != deviceFingerprint {
		return ErrDeviceFingerprintMismatch
	}

	now := time.Now()
	if err := s.DB().WithContext(ctx).Model(row).Updates(map[string]any{
		"status":     tables.AoneDeviceAuthorizationStatusRevoked,
		"revoked_at": now,
		"updated_at": now,
	}).Error; err != nil {
		return err
	}
	return s.RevokeAoneDeviceTemporaryCredentialsForDevice(ctx, row.ID)
}

// RevokeAllAoneDeviceAuthorizationsForUser invalidates every device authorization
// linked to an Aone user (logout, disable, or admin action).
func (s *RDBConfigStore) RevokeAllAoneDeviceAuthorizationsForUser(ctx context.Context, aoneUserID string) error {
	aoneUserID = strings.TrimSpace(aoneUserID)
	if aoneUserID == "" {
		return nil
	}
	now := time.Now()
	if err := s.DB().WithContext(ctx).
		Model(&tables.AoneDeviceAuthorizationTable{}).
		Where("aone_user_id = ? AND status = ?", aoneUserID, tables.AoneDeviceAuthorizationStatusActive).
		Updates(map[string]any{
			"status":     tables.AoneDeviceAuthorizationStatusRevoked,
			"revoked_at": now,
			"updated_at": now,
		}).Error; err != nil {
		return err
	}
	return s.RevokeAoneDeviceTemporaryCredentialsForUser(ctx, aoneUserID)
}

// CreateAoneUserDeviceAccessSession creates a short-lived dashboard session token
// for a desktop client without setting browser cookies.
func (s *RDBConfigStore) CreateAoneUserDeviceAccessSession(
	ctx context.Context,
	aoneUserID, loginSource string,
	deviceAuthorizationID *int,
	expiresAt time.Time,
) (token string, err error) {
	aoneUserID = strings.TrimSpace(aoneUserID)
	if aoneUserID == "" {
		return "", fmt.Errorf("aone user id is required")
	}
	if loginSource == "" {
		loginSource = "zwitch"
	}
	now := time.Now()
	token = uuid.NewString()
	session := &tables.SessionsTable{
		Token:                 token,
		ExpiresAt:             expiresAt,
		LoginSource:           loginSource,
		AoneUserID:            &aoneUserID,
		DeviceAuthorizationID: deviceAuthorizationID,
		CreatedAt:             now,
		UpdatedAt:             now,
	}
	if err := s.CreateSession(ctx, session); err != nil {
		return "", err
	}
	return token, nil
}

// AoneDeviceAuthorizationsQueryParams controls admin device listing.
type AoneDeviceAuthorizationsQueryParams struct {
	Limit  int
	Offset int
	Search string
	Status string
}

// AoneDeviceAuthorizationListItem is a device row enriched with user profile fields.
type AoneDeviceAuthorizationListItem struct {
	tables.AoneDeviceAuthorizationTable `gorm:"embedded"`
	UserDisplayName                     string `gorm:"column:user_display_name"`
	UserEmail                           string `gorm:"column:user_email"`
}

// GetAoneDeviceAuthorizationsPaginated lists device authorizations for the admin UI.
func (s *RDBConfigStore) GetAoneDeviceAuthorizationsPaginated(
	ctx context.Context,
	params AoneDeviceAuthorizationsQueryParams,
) ([]AoneDeviceAuthorizationListItem, int64, error) {
	baseQuery := s.DB().WithContext(ctx).
		Table("aone_device_authorizations AS d").
		Joins("LEFT JOIN aone_users AS u ON u.aone_user_id = d.aone_user_id")

	if search := strings.TrimSpace(params.Search); search != "" {
		like := "%" + strings.ToLower(search) + "%"
		baseQuery = baseQuery.Where(
			"LOWER(d.device_fingerprint) LIKE ? OR LOWER(d.device_name) LIKE ? OR LOWER(d.aone_user_id) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.display_name) LIKE ? OR LOWER(u.name) LIKE ?",
			like, like, like, like, like, like,
		)
	}
	if status := strings.TrimSpace(params.Status); status != "" {
		baseQuery = baseQuery.Where("d.status = ?", status)
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

	var rows []AoneDeviceAuthorizationListItem
	if err := baseQuery.
		Select(`d.*, COALESCE(NULLIF(u.display_name, ''), NULLIF(u.name, ''), u.email, d.aone_user_id) AS user_display_name, u.email AS user_email`).
		Order("COALESCE(d.last_api_access_at, d.updated_at) DESC, d.id DESC").
		Offset(offset).
		Limit(limit).
		Scan(&rows).Error; err != nil {
		return nil, 0, err
	}

	return rows, totalCount, nil
}

// GetAoneDeviceAuthorizationByID loads a device authorization row by primary key.
func (s *RDBConfigStore) GetAoneDeviceAuthorizationByID(ctx context.Context, id int) (*tables.AoneDeviceAuthorizationTable, error) {
	var row tables.AoneDeviceAuthorizationTable
	if err := s.DB().WithContext(ctx).First(&row, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDeviceAuthorizationNotFound
		}
		return nil, err
	}
	return &row, nil
}

// SetAoneDeviceAuthorizationStatus toggles a device authorization between active and revoked.
func (s *RDBConfigStore) SetAoneDeviceAuthorizationStatus(ctx context.Context, id int, active bool) (*tables.AoneDeviceAuthorizationTable, error) {
	row, err := s.GetAoneDeviceAuthorizationByID(ctx, id)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	if active {
		row.Status = tables.AoneDeviceAuthorizationStatusActive
		row.RevokedAt = nil
	} else {
		row.Status = tables.AoneDeviceAuthorizationStatusRevoked
		row.RevokedAt = &now
	}
	row.UpdatedAt = now
	if err := s.DB().WithContext(ctx).Save(row).Error; err != nil {
		return nil, err
	}
	// Revoke any live forwarding credentials when the device is deactivated.
	if !active {
		if err := s.RevokeAoneDeviceTemporaryCredentialsForDevice(ctx, row.ID); err != nil {
			return nil, err
		}
	}
	return row, nil
}

// TouchAoneDeviceAuthorizationLastAPIAccess records the latest forwarding API access time.
func (s *RDBConfigStore) TouchAoneDeviceAuthorizationLastAPIAccess(ctx context.Context, id int) error {
	if id <= 0 {
		return nil
	}
	now := time.Now()
	return s.DB().WithContext(ctx).
		Model(&tables.AoneDeviceAuthorizationTable{}).
		Where("id = ? AND status = ?", id, tables.AoneDeviceAuthorizationStatusActive).
		Updates(map[string]any{
			"last_api_access_at": now,
			"updated_at":         now,
		}).Error
}
