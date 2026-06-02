package configstore

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/maximhq/bifrost/framework/aoneoauth"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"gorm.io/gorm"
)

func sessionOAuthTokenHash(sessionToken string) string {
	sessionToken = strings.TrimSpace(sessionToken)
	if sessionToken == "" {
		return ""
	}
	return encrypt.HashSHA256(sessionToken)
}

// UpsertAoneUserOAuthToken stores or updates Aone OAuth2 tokens scoped to a dashboard session.
// When sessionToken is set, each concurrent login keeps its own refresh credentials.
func (s *RDBConfigStore) UpsertAoneUserOAuthToken(
	ctx context.Context,
	aoneUserID, loginSource, sessionToken string,
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

	sessionHash := sessionOAuthTokenHash(sessionToken)
	now := time.Now()
	expiresAt := aoneOAuthTokenExpiresAt(tokenResp, now)
	patch := tables.AoneUserOAuthTokenTable{
		AoneUserID:         aoneUserID,
		LoginSource:        loginSource,
		SessionTokenHash:   sessionHash,
		AccessToken:        strings.TrimSpace(tokenResp.AccessToken),
		RefreshToken:       strings.TrimSpace(tokenResp.RefreshToken),
		TokenType:          strings.TrimSpace(tokenResp.TokenType),
		ExpiresAt:          expiresAt,
		LastRefreshedAt:    &now,
		UpdatedAt:          now,
	}
	if patch.TokenType == "" {
		patch.TokenType = "Bearer"
	}

	var existing tables.AoneUserOAuthTokenTable
	err := s.DB().WithContext(ctx).
		Where("aone_user_id = ? AND login_source = ? AND session_token_hash = ?", aoneUserID, loginSource, sessionHash).
		First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		patch.CreatedAt = now
		if err := s.DB().WithContext(ctx).Create(&patch).Error; err != nil {
			return nil, err
		}
		return s.GetAoneUserOAuthToken(ctx, aoneUserID, loginSource, sessionToken)
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
	return s.GetAoneUserOAuthToken(ctx, aoneUserID, loginSource, sessionToken)
}

// GetAoneUserOAuthToken returns stored OAuth tokens for a user, login source, and session.
// When no row exists for the session hash, a legacy row with an empty session_token_hash is used.
func (s *RDBConfigStore) GetAoneUserOAuthToken(ctx context.Context, aoneUserID, loginSource, sessionToken string) (*tables.AoneUserOAuthTokenTable, error) {
	aoneUserID = strings.TrimSpace(aoneUserID)
	loginSource = strings.TrimSpace(loginSource)
	if aoneUserID == "" || loginSource == "" {
		return nil, gorm.ErrRecordNotFound
	}

	sessionHash := sessionOAuthTokenHash(sessionToken)
	var row tables.AoneUserOAuthTokenTable
	err := s.DB().WithContext(ctx).
		Where("aone_user_id = ? AND login_source = ? AND session_token_hash = ?", aoneUserID, loginSource, sessionHash).
		First(&row).Error
	if err == nil {
		return &row, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if sessionHash == "" {
		return nil, gorm.ErrRecordNotFound
	}

	err = s.DB().WithContext(ctx).
		Where("aone_user_id = ? AND login_source = ? AND (session_token_hash = '' OR session_token_hash IS NULL)", aoneUserID, loginSource).
		First(&row).Error
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// DeleteAoneUserOAuthTokenForSession removes OAuth tokens bound to a single dashboard session.
func (s *RDBConfigStore) DeleteAoneUserOAuthTokenForSession(ctx context.Context, aoneUserID, loginSource, sessionToken string) error {
	aoneUserID = strings.TrimSpace(aoneUserID)
	loginSource = strings.TrimSpace(loginSource)
	sessionToken = strings.TrimSpace(sessionToken)
	if aoneUserID == "" || loginSource == "" || sessionToken == "" {
		return nil
	}
	sessionHash := sessionOAuthTokenHash(sessionToken)
	result := s.DB().WithContext(ctx).
		Where("aone_user_id = ? AND login_source = ? AND session_token_hash = ?", aoneUserID, loginSource, sessionHash).
		Delete(&tables.AoneUserOAuthTokenTable{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		return nil
	}
	return nil
}

// DeleteLegacyAoneUserOAuthToken removes the pre-multi-session OAuth row (empty session hash).
func (s *RDBConfigStore) DeleteLegacyAoneUserOAuthToken(ctx context.Context, aoneUserID, loginSource string) error {
	aoneUserID = strings.TrimSpace(aoneUserID)
	loginSource = strings.TrimSpace(loginSource)
	if aoneUserID == "" || loginSource == "" {
		return nil
	}
	return s.DB().WithContext(ctx).
		Where("aone_user_id = ? AND login_source = ? AND (session_token_hash = '' OR session_token_hash IS NULL)", aoneUserID, loginSource).
		Delete(&tables.AoneUserOAuthTokenTable{}).Error
}

// CountActiveAoneUserSessions counts non-expired dashboard sessions for a user and login source,
// optionally excluding the session identified by excludeSessionToken.
func (s *RDBConfigStore) CountActiveAoneUserSessions(ctx context.Context, aoneUserID, loginSource, excludeSessionToken string) (int64, error) {
	aoneUserID = strings.TrimSpace(aoneUserID)
	loginSource = strings.TrimSpace(loginSource)
	if aoneUserID == "" {
		return 0, nil
	}

	q := s.DB().WithContext(ctx).Model(&tables.SessionsTable{}).
		Where("aone_user_id = ? AND expires_at > ?", aoneUserID, time.Now())
	if loginSource != "" {
		q = q.Where("login_source = ?", loginSource)
	}
	if excludeSessionToken != "" {
		excludeHash := sessionOAuthTokenHash(excludeSessionToken)
		q = q.Where("token_hash != ?", excludeHash)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
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
