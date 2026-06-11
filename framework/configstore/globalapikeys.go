package configstore

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"gorm.io/gorm"
)

const GlobalAPIKeyPrefix = "bf-ak-"

var (
	ErrGlobalAPIKeyNotFound              = errors.New("global api key not found")
	ErrGlobalAPIKeyTokenUnavailable      = errors.New("global api key token unavailable")
	ErrGlobalAPIKeyTooManyAssignedUsers  = errors.New("global api key can only be assigned to one user")
)

const globalAPIKeyMaxAssignedUsers = 1

func generateGlobalAPIKeyToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("failed to generate global api key token: %w", err)
	}
	return GlobalAPIKeyPrefix + hex.EncodeToString(buf), nil
}

func globalAPIKeyPrefix(token string) string {
	if len(token) <= 12 {
		return token
	}
	return token[:12] + "..."
}

func encryptGlobalAPIKeyToken(token string) (string, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", nil
	}
	encrypted, err := encrypt.Encrypt(token)
	if err != nil {
		return "", fmt.Errorf("failed to encrypt global api key token: %w", err)
	}
	return encrypted, nil
}

// DecryptGlobalAPIKeyToken returns the plaintext token for quick-start access.
// When encryption is disabled the stored value is kept as plaintext.
func DecryptGlobalAPIKeyToken(tokenEncrypted string) string {
	tokenEncrypted = strings.TrimSpace(tokenEncrypted)
	if tokenEncrypted == "" {
		return ""
	}
	if !encrypt.IsEnabled() {
		return tokenEncrypted
	}
	plaintext, err := encrypt.Decrypt(tokenEncrypted)
	if err != nil {
		// Rows created while encryption was disabled store plaintext in this column.
		return tokenEncrypted
	}
	return plaintext
}

// GlobalAPIKeyAccessItem is the quick-start view of an assigned API key.
type GlobalAPIKeyAccessItem struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	TokenPrefix string    `json:"token_prefix"`
	Token       string    `json:"token,omitempty"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func ToGlobalAPIKeyAccessItems(keys []tables.GlobalAPIKey) []GlobalAPIKeyAccessItem {
	items := make([]GlobalAPIKeyAccessItem, 0, len(keys))
	for _, key := range keys {
		item := GlobalAPIKeyAccessItem{
			ID:          key.ID,
			Name:        key.Name,
			TokenPrefix: key.TokenPrefix,
			IsActive:    key.IsActive,
			CreatedAt:   key.CreatedAt,
			UpdatedAt:   key.UpdatedAt,
		}
		if token := DecryptGlobalAPIKeyToken(key.TokenEncrypted); token != "" {
			item.Token = token
		}
		items = append(items, item)
	}
	return items
}

func (s *RDBConfigStore) ListGlobalAPIKeys(ctx context.Context) ([]tables.GlobalAPIKey, error) {
	var keys []tables.GlobalAPIKey
	if err := s.DB().WithContext(ctx).Order("created_at DESC").Find(&keys).Error; err != nil {
		return nil, err
	}
	return keys, nil
}

func (s *RDBConfigStore) ListActiveGlobalAPIKeys(ctx context.Context) ([]tables.GlobalAPIKey, error) {
	keys, err := s.ListGlobalAPIKeys(ctx)
	if err != nil {
		return nil, err
	}
	active := make([]tables.GlobalAPIKey, 0, len(keys))
	for _, key := range keys {
		if key.IsActive {
			active = append(active, key)
		}
	}
	return active, nil
}

// IsGlobalAPIKeyAssignedToUser reports whether userID was explicitly assigned to the key.
func IsGlobalAPIKeyAssignedToUser(key tables.GlobalAPIKey, userID string) bool {
	if !key.IsActive {
		return false
	}
	userID = strings.TrimSpace(userID)
	if userID == "" || len(key.AllowedUserIDs) == 0 {
		return false
	}
	for _, allowedID := range key.AllowedUserIDs {
		if strings.TrimSpace(allowedID) == userID {
			return true
		}
	}
	return false
}

func normalizeGlobalAPIKeyAllowedUserIDs(allowedUserIDs []string) ([]string, error) {
	if len(allowedUserIDs) == 0 {
		return nil, nil
	}
	seen := make(map[string]struct{}, len(allowedUserIDs))
	normalized := make([]string, 0, len(allowedUserIDs))
	for _, userID := range allowedUserIDs {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			continue
		}
		if _, ok := seen[userID]; ok {
			continue
		}
		seen[userID] = struct{}{}
		normalized = append(normalized, userID)
	}
	if len(normalized) == 0 {
		return nil, nil
	}
	if len(normalized) > globalAPIKeyMaxAssignedUsers {
		return nil, ErrGlobalAPIKeyTooManyAssignedUsers
	}
	return normalized, nil
}

// GlobalAPIKeyAssignedUserID returns the sole assigned Aone user ID when present.
func GlobalAPIKeyAssignedUserID(key tables.GlobalAPIKey) string {
	if len(key.AllowedUserIDs) == 0 {
		return ""
	}
	return strings.TrimSpace(key.AllowedUserIDs[0])
}

// AoneUserDisplayName picks the best human-readable label for an Aone user row.
func AoneUserDisplayName(user *tables.AoneUserTable) string {
	if user == nil {
		return ""
	}
	if name := strings.TrimSpace(user.DisplayName); name != "" {
		return name
	}
	if name := strings.TrimSpace(user.Name); name != "" {
		return name
	}
	if email := strings.TrimSpace(user.Email); email != "" {
		return email
	}
	return strings.TrimSpace(user.AoneUserID)
}

func (s *RDBConfigStore) ListAssignedGlobalAPIKeysForUser(ctx context.Context, userID string) ([]tables.GlobalAPIKey, error) {
	keys, err := s.ListGlobalAPIKeys(ctx)
	if err != nil {
		return nil, err
	}
	assigned := make([]tables.GlobalAPIKey, 0, len(keys))
	for _, key := range keys {
		if IsGlobalAPIKeyAssignedToUser(key, userID) {
			assigned = append(assigned, key)
		}
	}
	return assigned, nil
}

func (s *RDBConfigStore) CreateGlobalAPIKey(ctx context.Context, name string, allowedUserIDs []string) (*tables.GlobalAPIKey, string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, "", fmt.Errorf("name is required")
	}

	normalizedAllowedUserIDs, err := normalizeGlobalAPIKeyAllowedUserIDs(allowedUserIDs)
	if err != nil {
		return nil, "", err
	}

	token, err := generateGlobalAPIKeyToken()
	if err != nil {
		return nil, "", err
	}

	tokenEncrypted, err := encryptGlobalAPIKeyToken(token)
	if err != nil {
		return nil, "", err
	}

	now := time.Now()
	key := &tables.GlobalAPIKey{
		ID:             uuid.New().String(),
		Name:           name,
		TokenHash:      encrypt.HashSHA256(token),
		TokenEncrypted: tokenEncrypted,
		TokenPrefix:    globalAPIKeyPrefix(token),
		IsActive:       true,
		AllowedUserIDs: normalizedAllowedUserIDs,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := s.DB().WithContext(ctx).Create(key).Error; err != nil {
		return nil, "", err
	}
	return key, token, nil
}

type GlobalAPIKeyUpdate struct {
	IsActive       *bool
	AllowedUserIDs *[]string
}

func (s *RDBConfigStore) UpdateGlobalAPIKey(ctx context.Context, id string, update GlobalAPIKeyUpdate) (*tables.GlobalAPIKey, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, ErrGlobalAPIKeyNotFound
	}
	if update.IsActive == nil && update.AllowedUserIDs == nil {
		return nil, fmt.Errorf("no fields to update")
	}

	var key tables.GlobalAPIKey
	if err := s.DB().WithContext(ctx).First(&key, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrGlobalAPIKeyNotFound
		}
		return nil, err
	}

	if update.IsActive != nil {
		key.IsActive = *update.IsActive
	}
	if update.AllowedUserIDs != nil {
		normalizedAllowedUserIDs, err := normalizeGlobalAPIKeyAllowedUserIDs(*update.AllowedUserIDs)
		if err != nil {
			return nil, err
		}
		key.AllowedUserIDs = normalizedAllowedUserIDs
	}
	key.UpdatedAt = time.Now()
	if err := s.DB().WithContext(ctx).Save(&key).Error; err != nil {
		return nil, err
	}
	return &key, nil
}

func (s *RDBConfigStore) SetGlobalAPIKeyActive(ctx context.Context, id string, isActive bool) (*tables.GlobalAPIKey, error) {
	return s.UpdateGlobalAPIKey(ctx, id, GlobalAPIKeyUpdate{IsActive: &isActive})
}

func (s *RDBConfigStore) DeleteGlobalAPIKey(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return ErrGlobalAPIKeyNotFound
	}
	result := s.DB().WithContext(ctx).Delete(&tables.GlobalAPIKey{}, "id = ?", id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrGlobalAPIKeyNotFound
	}
	return nil
}

func (s *RDBConfigStore) GetAssignedGlobalAPIKeyToken(ctx context.Context, userID, id string) (string, error) {
	userID = strings.TrimSpace(userID)
	id = strings.TrimSpace(id)
	if userID == "" || id == "" {
		return "", ErrGlobalAPIKeyNotFound
	}

	keys, err := s.ListAssignedGlobalAPIKeysForUser(ctx, userID)
	if err != nil {
		return "", err
	}
	for _, key := range keys {
		if key.ID != id {
			continue
		}
		token := DecryptGlobalAPIKeyToken(key.TokenEncrypted)
		if token == "" {
			return "", ErrGlobalAPIKeyTokenUnavailable
		}
		return token, nil
	}
	return "", ErrGlobalAPIKeyNotFound
}

func (s *RDBConfigStore) RotateGlobalAPIKeyToken(ctx context.Context, id string) (*tables.GlobalAPIKey, string, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, "", ErrGlobalAPIKeyNotFound
	}

	var key tables.GlobalAPIKey
	if err := s.DB().WithContext(ctx).First(&key, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", ErrGlobalAPIKeyNotFound
		}
		return nil, "", err
	}

	token, err := generateGlobalAPIKeyToken()
	if err != nil {
		return nil, "", err
	}
	tokenEncrypted, err := encryptGlobalAPIKeyToken(token)
	if err != nil {
		return nil, "", err
	}

	key.TokenHash = encrypt.HashSHA256(token)
	key.TokenEncrypted = tokenEncrypted
	key.TokenPrefix = globalAPIKeyPrefix(token)
	key.UpdatedAt = time.Now()
	if err := s.DB().WithContext(ctx).Save(&key).Error; err != nil {
		return nil, "", err
	}
	return &key, token, nil
}

func (s *RDBConfigStore) GetActiveGlobalAPIKeyByToken(ctx context.Context, token string) (*tables.GlobalAPIKey, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, nil
	}
	var key tables.GlobalAPIKey
	err := s.DB().WithContext(ctx).
		Where("token_hash = ? AND is_active = ?", encrypt.HashSHA256(token), true).
		First(&key).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &key, nil
}
