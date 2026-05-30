package configstore

import (
	"context"
	"strings"
	"time"

	"github.com/maximhq/bifrost/framework/aoneoauth"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
)

// UpsertAoneUserOAuthToken stores or updates Aone OAuth2 tokens for a user and login source.
func (s *RDBConfigStore) UpsertAoneUserOAuthToken(
	ctx context.Context,
	aoneUserID, loginSource string,
	tokenResp *aoneoauth.TokenResponse,
) (*tables.AoneUserOAuthTokenTable, error) {
	aoneUserID = strings.TrimSpace(aoneUserID)
	loginSource = strings.TrimSpace(loginSource)
	if aoneUserID == "" || loginSource == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if tokenResp == nil || strings.TrimSpace(tokenResp.AccessToken) == "" {
		return nil, gorm.ErrRecordNotFound
	}

	now := time.Now()
	expiresAt := aoneOAuthTokenExpiresAt(tokenResp, now)
	patch := tables.AoneUserOAuthTokenTable{
		AoneUserID:      aoneUserID,
		LoginSource:     loginSource,
		AccessToken:     strings.TrimSpace(tokenResp.AccessToken),
		RefreshToken:    strings.TrimSpace(tokenResp.RefreshToken),
		TokenType:       strings.TrimSpace(tokenResp.TokenType),
		ExpiresAt:       expiresAt,
		LastRefreshedAt: &now,
		UpdatedAt:       now,
	}
	if patch.TokenType == "" {
		patch.TokenType = "Bearer"
	}

	var existing tables.AoneUserOAuthTokenTable
	err := s.DB().WithContext(ctx).
		Where("aone_user_id = ? AND login_source = ?", aoneUserID, loginSource).
		First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		patch.CreatedAt = now
		if err := s.DB().WithContext(ctx).Create(&patch).Error; err != nil {
			return nil, err
		}
		return s.GetAoneUserOAuthToken(ctx, aoneUserID, loginSource)
	}
	if err != nil {
		return nil, err
	}

	existing.AccessToken = patch.AccessToken
	existing.RefreshToken = patch.RefreshToken
	existing.TokenType = patch.TokenType
	existing.ExpiresAt = patch.ExpiresAt
	existing.LastRefreshedAt = patch.LastRefreshedAt
	existing.UpdatedAt = now
	if err := s.DB().WithContext(ctx).Save(&existing).Error; err != nil {
		return nil, err
	}
	return s.GetAoneUserOAuthToken(ctx, aoneUserID, loginSource)
}

// GetAoneUserOAuthToken returns stored OAuth tokens for a user and login source.
func (s *RDBConfigStore) GetAoneUserOAuthToken(ctx context.Context, aoneUserID, loginSource string) (*tables.AoneUserOAuthTokenTable, error) {
	aoneUserID = strings.TrimSpace(aoneUserID)
	loginSource = strings.TrimSpace(loginSource)
	if aoneUserID == "" || loginSource == "" {
		return nil, gorm.ErrRecordNotFound
	}

	var row tables.AoneUserOAuthTokenTable
	if err := s.DB().WithContext(ctx).
		Where("aone_user_id = ? AND login_source = ?", aoneUserID, loginSource).
		First(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

// DeleteAoneUserOAuthTokens removes all stored OAuth tokens for an Aone user.
func (s *RDBConfigStore) DeleteAoneUserOAuthTokens(ctx context.Context, aoneUserID string) error {
	aoneUserID = strings.TrimSpace(aoneUserID)
	if aoneUserID == "" {
		return nil
	}
	return s.DB().WithContext(ctx).
		Where("aone_user_id = ?", aoneUserID).
		Delete(&tables.AoneUserOAuthTokenTable{}).Error
}

func aoneOAuthTokenExpiresAt(tokenResp *aoneoauth.TokenResponse, now time.Time) *time.Time {
	if tokenResp == nil || tokenResp.ExpiresIn <= 0 {
		return nil
	}
	expiresAt := now.Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	return &expiresAt
}
