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

var ErrGlobalAPIKeyNotFound = errors.New("global api key not found")

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

func (s *RDBConfigStore) ListGlobalAPIKeys(ctx context.Context) ([]tables.GlobalAPIKey, error) {
	var keys []tables.GlobalAPIKey
	if err := s.DB().WithContext(ctx).Order("created_at DESC").Find(&keys).Error; err != nil {
		return nil, err
	}
	return keys, nil
}

func (s *RDBConfigStore) CreateGlobalAPIKey(ctx context.Context, name string) (*tables.GlobalAPIKey, string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, "", fmt.Errorf("name is required")
	}

	token, err := generateGlobalAPIKeyToken()
	if err != nil {
		return nil, "", err
	}

	now := time.Now()
	key := &tables.GlobalAPIKey{
		ID:          uuid.New().String(),
		Name:        name,
		TokenHash:   encrypt.HashSHA256(token),
		TokenPrefix: globalAPIKeyPrefix(token),
		IsActive:    true,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.DB().WithContext(ctx).Create(key).Error; err != nil {
		return nil, "", err
	}
	return key, token, nil
}

func (s *RDBConfigStore) SetGlobalAPIKeyActive(ctx context.Context, id string, isActive bool) (*tables.GlobalAPIKey, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, ErrGlobalAPIKeyNotFound
	}

	var key tables.GlobalAPIKey
	if err := s.DB().WithContext(ctx).First(&key, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrGlobalAPIKeyNotFound
		}
		return nil, err
	}

	key.IsActive = isActive
	key.UpdatedAt = time.Now()
	if err := s.DB().WithContext(ctx).Save(&key).Error; err != nil {
		return nil, err
	}
	return &key, nil
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
