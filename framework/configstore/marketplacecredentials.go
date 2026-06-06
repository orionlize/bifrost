package configstore

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
)

// GetMarketplaceUserGitCredentials returns stored git tokens for a credential owner.
func (s *RDBConfigStore) GetMarketplaceUserGitCredentials(ctx context.Context, ownerID string) (*tables.TableMarketplaceUserCredentials, error) {
	ownerID = strings.TrimSpace(ownerID)
	if ownerID == "" {
		return nil, fmt.Errorf("owner id is required")
	}
	var row tables.TableMarketplaceUserCredentials
	err := s.DB().WithContext(ctx).Where("owner_id = ?", ownerID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &tables.TableMarketplaceUserCredentials{OwnerID: ownerID}, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// UpdateMarketplaceUserGitCredentials merges token updates for a credential owner.
func (s *RDBConfigStore) UpdateMarketplaceUserGitCredentials(
	ctx context.Context,
	ownerID string,
	update *schemas.MarketplaceUserGitCredentialsUpdate,
) (*schemas.MarketplaceUserGitCredentialsStatus, error) {
	ownerID = strings.TrimSpace(ownerID)
	if ownerID == "" {
		return nil, fmt.Errorf("owner id is required")
	}
	if update == nil {
		return nil, fmt.Errorf("update payload is nil")
	}

	row, err := s.GetMarketplaceUserGitCredentials(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		row.OwnerID = ownerID
	}

	if update.GitHubToken != nil {
		row.GitHubToken = strings.TrimSpace(*update.GitHubToken)
	}
	if update.GitLabToken != nil {
		row.GitLabToken = strings.TrimSpace(*update.GitLabToken)
	}

	now := time.Now()
	row.UpdatedAt = now
	if row.ID == 0 {
		row.CreatedAt = now
		if err := s.DB().WithContext(ctx).Create(row).Error; err != nil {
			return nil, err
		}
	} else {
		if err := s.DB().WithContext(ctx).Save(row).Error; err != nil {
			return nil, err
		}
	}

	return marketplaceGitCredentialsStatus(row), nil
}

func marketplaceGitCredentialsStatus(row *tables.TableMarketplaceUserCredentials) *schemas.MarketplaceUserGitCredentialsStatus {
	if row == nil {
		return &schemas.MarketplaceUserGitCredentialsStatus{}
	}
	return &schemas.MarketplaceUserGitCredentialsStatus{
		GitHubTokenConfigured: strings.TrimSpace(row.GitHubToken) != "",
		GitLabTokenConfigured: strings.TrimSpace(row.GitLabToken) != "",
	}
}
