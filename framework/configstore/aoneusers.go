package configstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/aoneoauth"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
)

const aoneUserVirtualKeyPrefix = "sk-bf-"

var (
	aoneUserVirtualKeyAllowedModels = schemas.WhiteList{"*"}
	aoneUserVirtualKeyMCPTools      = schemas.WhiteList{"*"}
)

// AoneUsersQueryParams holds pagination and search parameters for Aone user queries.
type AoneUsersQueryParams struct {
	Limit  int
	Offset int
	Search string
}

// UpsertAoneUserFromLogin creates or updates an Aone user record from /api/oauth2/me data.
func (s *RDBConfigStore) UpsertAoneUserFromLogin(ctx context.Context, me *aoneoauth.MeResponse) (*tables.AoneUserTable, error) {
	if me == nil || me.User.ID == "" {
		return nil, gorm.ErrRecordNotFound
	}

	now := time.Now()
	patch := buildAoneUserPatch(me, now)

	var existing tables.AoneUserTable
	err := s.DB().WithContext(ctx).Where("aone_user_id = ?", me.User.ID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		user := patch
		user.AoneUserID = me.User.ID
		user.LoginCount = 1
		user.LastLoginAt = now
		user.CreatedAt = now
		user.UpdatedAt = now
		if err := s.DB().WithContext(ctx).Create(&user).Error; err != nil {
			return nil, err
		}
		return &user, nil
	}
	if err != nil {
		return nil, err
	}
	if existing.IsDisabled {
		return nil, ErrAoneUserDisabled
	}

	applyAoneUserPatch(&existing, patch)
	existing.LoginCount++
	existing.LastLoginAt = now
	existing.UpdatedAt = now
	if err := s.DB().WithContext(ctx).Save(&existing).Error; err != nil {
		return nil, err
	}
	return &existing, nil
}

// GetAoneUsersPaginated returns paginated Aone users ordered by most recent login.
func (s *RDBConfigStore) GetAoneUsersPaginated(ctx context.Context, params AoneUsersQueryParams) ([]tables.AoneUserTable, int64, error) {
	baseQuery := s.DB().WithContext(ctx).Model(&tables.AoneUserTable{})

	if params.Search != "" {
		search := "%" + strings.ToLower(params.Search) + "%"
		baseQuery = baseQuery.Where(
			"LOWER(email) LIKE ? OR LOWER(name) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(department_names) LIKE ? OR LOWER(job_title) LIKE ?",
			search, search, search, search, search,
		)
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

	var users []tables.AoneUserTable
	if err := baseQuery.
		Order("last_login_at DESC, id DESC").
		Offset(offset).
		Limit(limit).
		Find(&users).Error; err != nil {
		return nil, 0, err
	}

	return users, totalCount, nil
}

// GetAoneUserByAoneID returns a single Aone user by upstream user id.
func (s *RDBConfigStore) GetAoneUserByAoneID(ctx context.Context, aoneUserID string) (*tables.AoneUserTable, error) {
	var user tables.AoneUserTable
	if err := s.DB().WithContext(ctx).Where("aone_user_id = ?", aoneUserID).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// EnsureAoneUserVirtualKey creates or returns the personal virtual key for an Aone OAuth user.
func (s *RDBConfigStore) EnsureAoneUserVirtualKey(ctx context.Context, aoneUserID string) (*tables.TableVirtualKey, error) {
	if aoneUserID == "" {
		return nil, gorm.ErrRecordNotFound
	}

	user, err := s.GetAoneUserByAoneID(ctx, aoneUserID)
	if err != nil {
		return nil, err
	}
	if user.IsDisabled {
		return nil, ErrAoneUserDisabled
	}

	if user.VirtualKeyID != nil && *user.VirtualKeyID != "" {
		existing, err := s.GetVirtualKey(ctx, *user.VirtualKeyID)
		if err == nil && existing != nil {
			return s.finalizeAoneUserVirtualKey(ctx, existing)
		}
		if err != nil && err != ErrNotFound {
			return nil, err
		}
	}

	var created tables.TableVirtualKey
	err = s.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		tx = tx.WithContext(ctx)

		var locked tables.AoneUserTable
		if err := tx.Where("aone_user_id = ?", aoneUserID).First(&locked).Error; err != nil {
			return err
		}
		if locked.VirtualKeyID != nil && *locked.VirtualKeyID != "" {
			var existing tables.TableVirtualKey
			if err := tx.First(&existing, "id = ?", *locked.VirtualKeyID).Error; err == nil {
				created = existing
				return nil
			}
			if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
		}

		providers, err := s.GetProviders(ctx)
		if err != nil {
			return err
		}
		mcpClients, _, err := s.GetMCPClientsPaginated(ctx, MCPClientsQueryParams{Limit: 10000})
		if err != nil {
			return err
		}

		isActive := bifrost.Ptr(true)
		vkID := uuid.NewString()
		vk := tables.TableVirtualKey{
			ID:              vkID,
			Name:            uniqueAoneUserVirtualKeyName(&locked),
			Description:     "Auto-provisioned personal key for Aone OAuth sign-in",
			Value:           aoneUserVirtualKeyPrefix + uuid.NewString(),
			IsActive:        isActive,
			CreatedByUserID: &locked.AoneUserID,
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
		}
		if err := tx.Create(&vk).Error; err != nil {
			return err
		}

		for _, provider := range providers {
			providerConfig := newAoneUserVirtualKeyProviderConfig(vk.ID, provider.Name)
			if err := tx.Create(providerConfig).Error; err != nil {
				return fmt.Errorf("create provider config for aone user virtual key: %w", err)
			}
		}

		for _, client := range mcpClients {
			mcpConfig := newAoneUserVirtualKeyMCPConfig(vk.ID, client.ID)
			if err := tx.Create(mcpConfig).Error; err != nil {
				return fmt.Errorf("create mcp config for aone user virtual key: %w", err)
			}
		}

		locked.VirtualKeyID = &vkID
		locked.UpdatedAt = time.Now()
		if err := tx.Save(&locked).Error; err != nil {
			return err
		}
		created = vk
		return nil
	})
	if err != nil {
		return nil, err
	}

	preloaded, err := s.GetVirtualKey(ctx, created.ID)
	if err != nil {
		return s.finalizeAoneUserVirtualKey(ctx, &created)
	}
	return s.finalizeAoneUserVirtualKey(ctx, preloaded)
}

func (s *RDBConfigStore) finalizeAoneUserVirtualKey(ctx context.Context, vk *tables.TableVirtualKey) (*tables.TableVirtualKey, error) {
	if vk == nil {
		return nil, gorm.ErrRecordNotFound
	}
	synced, err := s.syncAoneUserVirtualKeyAccess(ctx, vk.ID)
	if err != nil {
		return nil, err
	}
	return s.activateAoneUserVirtualKeyIfNeeded(ctx, synced)
}

// syncAoneUserVirtualKeyAccess ensures auto-provisioned keys grant access to all
// currently configured providers and MCP clients. Existing keys are updated in
// place so newly added providers (for example openai) remain usable.
func (s *RDBConfigStore) syncAoneUserVirtualKeyAccess(ctx context.Context, virtualKeyID string) (*tables.TableVirtualKey, error) {
	if virtualKeyID == "" {
		return nil, gorm.ErrRecordNotFound
	}

	providers, err := s.GetProviders(ctx)
	if err != nil {
		return nil, err
	}
	existingPCs, err := s.GetVirtualKeyProviderConfigs(ctx, virtualKeyID)
	if err != nil {
		return nil, err
	}
	configuredProviders := make(map[string]struct{}, len(existingPCs))
	for _, pc := range existingPCs {
		configuredProviders[pc.Provider] = struct{}{}
		if err := s.upgradeAoneUserProviderConfig(ctx, &pc); err != nil {
			return nil, err
		}
	}
	for _, provider := range providers {
		if _, ok := configuredProviders[provider.Name]; ok {
			continue
		}
		providerConfig := newAoneUserVirtualKeyProviderConfig(virtualKeyID, provider.Name)
		if err := s.CreateVirtualKeyProviderConfig(ctx, providerConfig); err != nil {
			return nil, fmt.Errorf("sync provider config for aone user virtual key: %w", err)
		}
	}

	mcpClients, _, err := s.GetMCPClientsPaginated(ctx, MCPClientsQueryParams{Limit: 10000})
	if err != nil {
		return nil, err
	}
	existingMCP, err := s.GetVirtualKeyMCPConfigs(ctx, virtualKeyID)
	if err != nil {
		return nil, err
	}
	configuredMCP := make(map[uint]struct{}, len(existingMCP))
	for _, mc := range existingMCP {
		configuredMCP[mc.MCPClientID] = struct{}{}
		if err := s.upgradeAoneUserMCPConfig(ctx, &mc); err != nil {
			return nil, err
		}
	}
	for _, client := range mcpClients {
		if _, ok := configuredMCP[client.ID]; ok {
			continue
		}
		mcpConfig := newAoneUserVirtualKeyMCPConfig(virtualKeyID, client.ID)
		if err := s.CreateVirtualKeyMCPConfig(ctx, mcpConfig); err != nil {
			return nil, fmt.Errorf("sync mcp config for aone user virtual key: %w", err)
		}
	}

	return s.GetVirtualKey(ctx, virtualKeyID)
}

func (s *RDBConfigStore) activateAoneUserVirtualKeyIfNeeded(ctx context.Context, vk *tables.TableVirtualKey) (*tables.TableVirtualKey, error) {
	if vk == nil || vk.IsActiveValue() {
		return vk, nil
	}
	vk.IsActive = bifrost.Ptr(true)
	vk.UpdatedAt = time.Now()
	if err := s.UpdateVirtualKey(ctx, vk); err != nil {
		return nil, fmt.Errorf("reactivate aone user virtual key: %w", err)
	}
	preloaded, err := s.GetVirtualKey(ctx, vk.ID)
	if err != nil {
		return vk, nil
	}
	return preloaded, nil
}

func newAoneUserVirtualKeyProviderConfig(virtualKeyID, providerName string) *tables.TableVirtualKeyProviderConfig {
	return &tables.TableVirtualKeyProviderConfig{
		VirtualKeyID:  virtualKeyID,
		Provider:      providerName,
		Weight:        bifrost.Ptr(1.0),
		AllowedModels: aoneUserVirtualKeyAllowedModels,
		AllowAllKeys:  true,
	}
}

func newAoneUserVirtualKeyMCPConfig(virtualKeyID string, mcpClientID uint) *tables.TableVirtualKeyMCPConfig {
	return &tables.TableVirtualKeyMCPConfig{
		VirtualKeyID:   virtualKeyID,
		MCPClientID:    mcpClientID,
		ToolsToExecute: aoneUserVirtualKeyMCPTools,
	}
}

func (s *RDBConfigStore) upgradeAoneUserProviderConfig(ctx context.Context, pc *tables.TableVirtualKeyProviderConfig) error {
	if pc == nil {
		return nil
	}
	updated := *pc
	changed := false
	if updated.AllowedModels.IsEmpty() {
		updated.AllowedModels = aoneUserVirtualKeyAllowedModels
		changed = true
	}
	if !updated.AllowAllKeys {
		updated.AllowAllKeys = true
		changed = true
	}
	if !changed {
		return nil
	}
	if err := s.UpdateVirtualKeyProviderConfig(ctx, &updated); err != nil {
		return fmt.Errorf("upgrade provider config for aone user virtual key: %w", err)
	}
	return nil
}

func (s *RDBConfigStore) upgradeAoneUserMCPConfig(ctx context.Context, mc *tables.TableVirtualKeyMCPConfig) error {
	if mc == nil {
		return nil
	}
	if !mc.ToolsToExecute.IsEmpty() {
		return nil
	}
	updated := *mc
	updated.ToolsToExecute = aoneUserVirtualKeyMCPTools
	if err := s.UpdateVirtualKeyMCPConfig(ctx, &updated); err != nil {
		return fmt.Errorf("upgrade mcp config for aone user virtual key: %w", err)
	}
	return nil
}

// GetAoneUserIDByVirtualKeyValue resolves the Aone user that owns the personal
// virtual key identified by the given value. It returns "" (and a nil error) when
// the value is not an Aone-user virtual key — i.e. an unknown value, or a virtual
// key not linked to an Aone user. Used to gate API forwarding by device
// fingerprint when the inference credential is a personal Aone virtual key.
func (s *RDBConfigStore) GetAoneUserIDByVirtualKeyValue(ctx context.Context, value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}

	vk, err := s.GetVirtualKeyByValue(ctx, value)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return "", nil
		}
		return "", err
	}
	if vk == nil || vk.CreatedByUserID == nil || strings.TrimSpace(*vk.CreatedByUserID) == "" {
		return "", nil
	}

	// Confirm the virtual key is actually linked to an Aone user (rather than a
	// generic dashboard-created key that happens to carry a CreatedByUserID).
	var user tables.AoneUserTable
	err = s.DB().WithContext(ctx).
		Where("aone_user_id = ? AND virtual_key_id = ?", strings.TrimSpace(*vk.CreatedByUserID), vk.ID).
		First(&user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil
		}
		return "", err
	}
	return user.AoneUserID, nil
}

// SetAoneUserDisabled toggles local admin disablement for an Aone user.
func (s *RDBConfigStore) SetAoneUserDisabled(ctx context.Context, aoneUserID string, disabled bool) (*tables.AoneUserTable, error) {
	user, err := s.GetAoneUserByAoneID(ctx, aoneUserID)
	if err != nil {
		return nil, err
	}

	user.IsDisabled = disabled
	user.UpdatedAt = time.Now()
	if err := s.DB().WithContext(ctx).Save(user).Error; err != nil {
		return nil, err
	}

	if user.VirtualKeyID != nil && *user.VirtualKeyID != "" {
		vk, vkErr := s.GetVirtualKey(ctx, *user.VirtualKeyID)
		if vkErr == nil && vk != nil {
			isActive := bifrost.Ptr(!disabled)
			vk.IsActive = isActive
			vk.UpdatedAt = time.Now()
			if err := s.UpdateVirtualKey(ctx, vk); err != nil {
				return nil, fmt.Errorf("update linked virtual key: %w", err)
			}
		} else if vkErr != nil && !errors.Is(vkErr, ErrNotFound) {
			return nil, vkErr
		}
	}

	if disabled {
		if err := s.DeleteAoneUserSessions(ctx, aoneUserID); err != nil {
			return nil, fmt.Errorf("delete user sessions: %w", err)
		}
		if err := s.DeleteAoneUserOAuthTokens(ctx, aoneUserID); err != nil {
			return nil, fmt.Errorf("delete user oauth tokens: %w", err)
		}
		if err := s.RevokeAllAoneDeviceAuthorizationsForUser(ctx, aoneUserID); err != nil {
			return nil, fmt.Errorf("revoke device authorizations: %w", err)
		}
	}

	return user, nil
}

// RotateAoneUserVirtualKey rotates the personal virtual key linked to an Aone user.
func (s *RDBConfigStore) RotateAoneUserVirtualKey(ctx context.Context, aoneUserID string) (*tables.TableVirtualKey, error) {
	user, err := s.GetAoneUserByAoneID(ctx, aoneUserID)
	if err != nil {
		return nil, err
	}
	if user.IsDisabled {
		return nil, ErrAoneUserDisabled
	}

	vk, err := s.EnsureAoneUserVirtualKey(ctx, aoneUserID)
	if err != nil {
		return nil, err
	}

	oldValue := vk.Value
	vk.Value = aoneUserVirtualKeyPrefix + uuid.NewString()
	if vk.Value == oldValue {
		return nil, fmt.Errorf("generated virtual key matched existing value")
	}
	isActive := bifrost.Ptr(true)
	vk.IsActive = isActive
	vk.UpdatedAt = time.Now()
	if err := s.UpdateVirtualKey(ctx, vk); err != nil {
		return nil, err
	}

	preloaded, err := s.GetVirtualKey(ctx, vk.ID)
	if err != nil {
		return vk, nil
	}
	return preloaded, nil
}

// DeleteAoneUserSessions removes all dashboard sessions linked to an Aone user.
func (s *RDBConfigStore) DeleteAoneUserSessions(ctx context.Context, aoneUserID string) error {
	if aoneUserID == "" {
		return nil
	}
	return s.DB().WithContext(ctx).Where("aone_user_id = ?", aoneUserID).Delete(&tables.SessionsTable{}).Error
}

func buildAoneUserPatch(me *aoneoauth.MeResponse, now time.Time) tables.AoneUserTable {
	user := tables.AoneUserTable{
		AoneUserID:    me.User.ID,
		Email:         me.User.Email,
		Name:          me.User.Name,
		Avatar:        me.User.Avatar,
		Status:        me.User.Status,
		EmailVerified: me.User.EmailVerified,
		DisplayName:   me.User.Name,
		DisplayAvatar: me.User.Avatar,
	}

	if me.User.CreatedAt != "" {
		if parsed, err := time.Parse(time.RFC3339, string(me.User.CreatedAt)); err == nil {
			user.UserCreatedAt = &parsed
		}
	}

	if me.Dingtalk != nil {
		if data, err := json.Marshal(me.Dingtalk); err == nil {
			user.DingtalkJSON = string(data)
		}
		user.DepartmentNames = formatAoneDepartments(me.Dingtalk.Departments)
		if me.Dingtalk.Profile.Name != "" {
			user.DisplayName = me.Dingtalk.Profile.Name
		}
		if me.Dingtalk.Profile.Avatar != "" {
			user.DisplayAvatar = me.Dingtalk.Profile.Avatar
		} else if me.Dingtalk.Profile.Name != "" && user.DisplayAvatar == "" {
			user.DisplayAvatar = me.User.Avatar
		}
		user.JobTitle = me.Dingtalk.Profile.Title
	}

	if data, err := json.Marshal(me.Application); err == nil {
		user.ApplicationJSON = string(data)
	}

	_ = now
	return user
}

func applyAoneUserPatch(existing *tables.AoneUserTable, patch tables.AoneUserTable) {
	existing.Email = patch.Email
	existing.Name = patch.Name
	existing.Avatar = patch.Avatar
	existing.Status = patch.Status
	existing.EmailVerified = patch.EmailVerified
	existing.UserCreatedAt = patch.UserCreatedAt
	existing.DingtalkJSON = patch.DingtalkJSON
	existing.ApplicationJSON = patch.ApplicationJSON
	existing.DepartmentNames = patch.DepartmentNames
	existing.DisplayName = patch.DisplayName
	existing.DisplayAvatar = patch.DisplayAvatar
	existing.JobTitle = patch.JobTitle
}

func formatAoneDepartments(departments []aoneoauth.DingtalkDepartment) string {
	if len(departments) == 0 {
		return ""
	}
	names := make([]string, 0, len(departments))
	for _, dept := range departments {
		if dept.Name != "" {
			names = append(names, dept.Name)
		}
	}
	return strings.Join(names, " / ")
}

// AoneUserRankingDisplayName returns the label shown in dashboard user rankings.
func AoneUserRankingDisplayName(user *tables.AoneUserTable) string {
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
	return user.AoneUserID
}

func uniqueAoneUserVirtualKeyName(user *tables.AoneUserTable) string {
	label := user.DisplayName
	if label == "" {
		label = user.Email
	}
	if label == "" {
		label = user.AoneUserID
	}
	label = strings.TrimSpace(label)
	if len(label) > 80 {
		label = label[:80]
	}
	base := fmt.Sprintf("Aone: %s", label)
	suffix := user.AoneUserID
	if len(suffix) > 8 {
		suffix = suffix[:8]
	}
	return fmt.Sprintf("%s (%s)", base, suffix)
}
