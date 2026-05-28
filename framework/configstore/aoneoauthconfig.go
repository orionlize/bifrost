package configstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"gorm.io/gorm"
)

func loadAoneOAuthConfig(ctx context.Context, db *gorm.DB) (*AoneOAuthConfig, error) {
	var configEntry tables.TableGovernanceConfig
	if err := db.WithContext(ctx).First(&configEntry, "key = ?", tables.ConfigAoneOAuthKey).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	if configEntry.Value == "" {
		return nil, nil
	}
	var cfg AoneOAuthConfig
	if err := json.Unmarshal([]byte(configEntry.Value), &cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal aone oauth config: %w", err)
	}
	if cfg.ClientSecret != nil && cfg.ClientSecret.GetValue() != "" {
		decrypted, err := encrypt.Decrypt(cfg.ClientSecret.GetValue())
		if err != nil {
			if !errors.Is(err, encrypt.ErrEncryptionKeyNotInitialized) {
				return nil, fmt.Errorf("failed to decrypt aone oauth client secret: %w", err)
			}
		} else {
			cfg.ClientSecret = schemas.NewEnvVar(decrypted)
		}
	}
	return &cfg, nil
}

func saveAoneOAuthConfig(ctx context.Context, tx *gorm.DB, cfg *AoneOAuthConfig) error {
	if cfg == nil {
		return tx.WithContext(ctx).Where("key = ?", tables.ConfigAoneOAuthKey).Delete(&tables.TableGovernanceConfig{}).Error
	}
	cfgCopy := *cfg
	if cfgCopy.ClientSecret != nil && cfgCopy.ClientSecret.GetValue() != "" && !cfgCopy.ClientSecret.IsRedacted() {
		encrypted, err := encrypt.Encrypt(cfgCopy.ClientSecret.GetValue())
		if err != nil {
			return fmt.Errorf("failed to encrypt aone oauth client secret: %w", err)
		}
		cfgCopy.ClientSecret = schemas.NewEnvVar(encrypted)
	}
	configJSON, err := json.Marshal(&cfgCopy)
	if err != nil {
		return fmt.Errorf("failed to marshal aone oauth config: %w", err)
	}
	return tx.WithContext(ctx).Save(&tables.TableGovernanceConfig{
		Key:   tables.ConfigAoneOAuthKey,
		Value: string(configJSON),
	}).Error
}
