// Package handlers: HTTP CRUD for user groups (tags) backing tiered model degradation.
package handlers

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/bytedance/sonic"
	"github.com/google/uuid"
	bifrost "github.com/maximhq/bifrost/core"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// UserGroupTierMappingRequest is a single "source model -> downgraded model" entry.
type UserGroupTierMappingRequest struct {
	SourceProvider *string `json:"source_provider,omitempty"`
	SourceKeyID    *string `json:"source_key_id,omitempty"`
	SourceModel    string  `json:"source_model"`
	TargetProvider *string `json:"target_provider,omitempty"`
	TargetKeyID    *string `json:"target_key_id,omitempty"`
	TargetModel    string  `json:"target_model"`
}

// UserGroupTierRequest describes one degradation tier.
type UserGroupTierRequest struct {
	Order        int                           `json:"order"`
	ThresholdPct float64                       `json:"threshold_pct"`
	IsTerminal   bool                          `json:"is_terminal"`
	Fallbacks    []string                      `json:"fallbacks,omitempty"`
	Mappings     []UserGroupTierMappingRequest `json:"mappings,omitempty"`
}

// CreateUserGroupRequest is the payload for creating a user group.
type CreateUserGroupRequest struct {
	Name        string `json:"name" validate:"required"`
	Description string `json:"description,omitempty"`
	Color       string `json:"color,omitempty"`
	Enabled     *bool  `json:"enabled,omitempty"`

	ShortWindowTokenLimit    *int64  `json:"short_window_token_limit,omitempty"`
	ShortWindowResetDuration *string `json:"short_window_reset_duration,omitempty"`

	WeeklyWindowTokenLimit    *int64  `json:"weekly_window_token_limit,omitempty"`
	WeeklyWindowResetDuration *string `json:"weekly_window_reset_duration,omitempty"`

	CalendarAligned bool `json:"calendar_aligned,omitempty"`

	Tiers         []UserGroupTierRequest `json:"tiers,omitempty"`
	VirtualKeyIDs []string               `json:"virtual_key_ids,omitempty"`
}

// UpdateUserGroupRequest is the payload for updating a user group. Nil fields are
// left unchanged; a non-nil Tiers / VirtualKeyIDs fully replaces the existing set.
type UpdateUserGroupRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	Color       *string `json:"color,omitempty"`
	Enabled     *bool   `json:"enabled,omitempty"`

	ShortWindowTokenLimit    *int64  `json:"short_window_token_limit,omitempty"`
	ShortWindowResetDuration *string `json:"short_window_reset_duration,omitempty"`

	WeeklyWindowTokenLimit    *int64  `json:"weekly_window_token_limit,omitempty"`
	WeeklyWindowResetDuration *string `json:"weekly_window_reset_duration,omitempty"`

	CalendarAligned *bool `json:"calendar_aligned,omitempty"`

	Tiers         *[]UserGroupTierRequest `json:"tiers,omitempty"`
	VirtualKeyIDs *[]string               `json:"virtual_key_ids,omitempty"`
}

// SetUserGroupMembersRequest replaces the virtual-key membership of a group.
type SetUserGroupMembersRequest struct {
	VirtualKeyIDs []string `json:"virtual_key_ids"`
}

// ResetUserGroupMemberUsageRequest clears window counters for one group member.
type ResetUserGroupMemberUsageRequest struct {
	Identity string `json:"identity"`
}

// validateUserGroupTiers validates tier thresholds and mappings.
func validateUserGroupTiers(tiers []UserGroupTierRequest) error {
	for i, t := range tiers {
		if t.ThresholdPct < 0 || t.ThresholdPct > 100 {
			return fmt.Errorf("tier %d: threshold_pct must be between 0 and 100", i)
		}
		for j, m := range t.Mappings {
			if m.SourceModel == "" {
				return fmt.Errorf("tier %d mapping %d: source_model is required", i, j)
			}
			if m.TargetModel == "" {
				return fmt.Errorf("tier %d mapping %d: target_model is required", i, j)
			}
		}
	}
	return nil
}

func normalizeOptionalKeyID(s *string) *string {
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// buildUserGroupTiers converts tier request DTOs to table rows for a group.
func buildUserGroupTiers(groupID string, tiers []UserGroupTierRequest) []configstoreTables.TableUserGroupTier {
	out := make([]configstoreTables.TableUserGroupTier, 0, len(tiers))
	for _, t := range tiers {
		tierID := uuid.NewString()
		mappings := make([]configstoreTables.TableUserGroupTierMapping, 0, len(t.Mappings))
		for _, m := range t.Mappings {
			mappings = append(mappings, configstoreTables.TableUserGroupTierMapping{
				ID:             uuid.NewString(),
				TierID:         tierID,
				SourceProvider: m.SourceProvider,
				SourceKeyID:    normalizeOptionalKeyID(m.SourceKeyID),
				SourceModel:    m.SourceModel,
				TargetProvider: m.TargetProvider,
				TargetKeyID:    normalizeOptionalKeyID(m.TargetKeyID),
				TargetModel:    m.TargetModel,
			})
		}
		out = append(out, configstoreTables.TableUserGroupTier{
			ID:              tierID,
			UserGroupID:     groupID,
			TierOrder:       t.Order,
			ThresholdPct:    t.ThresholdPct,
			IsTerminal:      t.IsTerminal,
			ParsedFallbacks: t.Fallbacks,
			Mappings:        mappings,
		})
	}
	return out
}

// loadUserGroupWithRelations loads a group with tiers (ordered), mappings, and member count.
func (h *GovernanceHandler) loadUserGroupWithRelations(ctx *fasthttp.RequestCtx, id string) (*configstoreTables.TableUserGroup, error) {
	db := h.configStore.ScopedDB(ctx)
	var group configstoreTables.TableUserGroup
	if err := db.
		Preload("Tiers", func(tx *gorm.DB) *gorm.DB { return tx.Order("tier_order ASC") }).
		Preload("Tiers.Mappings").
		Preload("Members").
		First(&group, "id = ?", id).Error; err != nil {
		return nil, err
	}
	group.MemberCount = int64(len(group.Members))
	return &group, nil
}

// getUserGroups handles GET /api/governance/user-groups
func (h *GovernanceHandler) getUserGroups(ctx *fasthttp.RequestCtx) {
	db := h.configStore.ScopedDB(ctx)
	var groups []configstoreTables.TableUserGroup
	if err := db.
		Preload("Tiers", func(tx *gorm.DB) *gorm.DB { return tx.Order("tier_order ASC") }).
		Preload("Tiers.Mappings").
		Preload("Members").
		Order("created_at ASC").
		Find(&groups).Error; err != nil {
		logger.Error("failed to list user groups: %v", err)
		SendError(ctx, 500, "Failed to retrieve user groups")
		return
	}
	for i := range groups {
		groups[i].MemberCount = int64(len(groups[i].Members))
	}
	SendJSON(ctx, map[string]interface{}{
		"user_groups": groups,
		"count":       len(groups),
	})
}

// getUserGroup handles GET /api/governance/user-groups/{group_id}
func (h *GovernanceHandler) getUserGroup(ctx *fasthttp.RequestCtx) {
	id, _ := ctx.UserValue("group_id").(string)
	group, err := h.loadUserGroupWithRelations(ctx, id)
	if err != nil {
		SendError(ctx, 404, "User group not found")
		return
	}
	SendJSON(ctx, map[string]interface{}{"user_group": group})
}

// createUserGroup handles POST /api/governance/user-groups
func (h *GovernanceHandler) createUserGroup(ctx *fasthttp.RequestCtx) {
	var req CreateUserGroupRequest
	if err := sonic.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, 400, "Invalid JSON")
		return
	}
	if req.Name == "" {
		SendError(ctx, 400, "name field is required")
		return
	}
	if err := validateUserGroupTiers(req.Tiers); err != nil {
		SendError(ctx, 400, err.Error())
		return
	}

	groupID := uuid.NewString()
	enabled := req.Enabled
	if enabled == nil {
		enabled = bifrost.Ptr(true)
	}
	group := &configstoreTables.TableUserGroup{
		ID:                        groupID,
		Name:                      req.Name,
		Description:               req.Description,
		Color:                     req.Color,
		Enabled:                   enabled,
		ShortWindowTokenLimit:     req.ShortWindowTokenLimit,
		ShortWindowResetDuration:  req.ShortWindowResetDuration,
		WeeklyWindowTokenLimit:    req.WeeklyWindowTokenLimit,
		WeeklyWindowResetDuration: req.WeeklyWindowResetDuration,
		CalendarAligned:           req.CalendarAligned,
		Tiers:                     buildUserGroupTiers(groupID, req.Tiers),
	}
	members := buildUserGroupMembers(groupID, req.VirtualKeyIDs)

	if err := h.configStore.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		if err := tx.Create(group).Error; err != nil {
			return err
		}
		if len(members) > 0 {
			if err := tx.Create(&members).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		SendError(ctx, 500, fmt.Sprintf("Failed to create user group: %v", err))
		return
	}

	if err := h.governanceManager.ReloadUserGroups(ctx); err != nil {
		SendError(ctx, 500, fmt.Sprintf("Failed to reload user groups in memory: %v, please restart bifrost to sync with the database", err))
		return
	}

	out, err := h.loadUserGroupWithRelations(ctx, groupID)
	if err != nil {
		out = group
	}
	SendJSON(ctx, map[string]interface{}{
		"message":    "User group created successfully",
		"user_group": out,
	})
}

// updateUserGroup handles PUT /api/governance/user-groups/{group_id}
func (h *GovernanceHandler) updateUserGroup(ctx *fasthttp.RequestCtx) {
	id, _ := ctx.UserValue("group_id").(string)

	var req UpdateUserGroupRequest
	if err := sonic.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, 400, "Invalid JSON")
		return
	}
	if req.Tiers != nil {
		if err := validateUserGroupTiers(*req.Tiers); err != nil {
			SendError(ctx, 400, err.Error())
			return
		}
	}

	db := h.configStore.ScopedDB(ctx)
	var group configstoreTables.TableUserGroup
	if err := db.First(&group, "id = ?", id).Error; err != nil {
		SendError(ctx, 404, "User group not found")
		return
	}

	if req.Name != nil && *req.Name != "" {
		group.Name = *req.Name
	}
	if req.Description != nil {
		group.Description = *req.Description
	}
	if req.Color != nil {
		group.Color = *req.Color
	}
	if req.Enabled != nil {
		group.Enabled = req.Enabled
	}
	if req.ShortWindowTokenLimit != nil {
		group.ShortWindowTokenLimit = req.ShortWindowTokenLimit
	}
	if req.ShortWindowResetDuration != nil {
		group.ShortWindowResetDuration = req.ShortWindowResetDuration
	}
	if req.WeeklyWindowTokenLimit != nil {
		group.WeeklyWindowTokenLimit = req.WeeklyWindowTokenLimit
	}
	if req.WeeklyWindowResetDuration != nil {
		group.WeeklyWindowResetDuration = req.WeeklyWindowResetDuration
	}
	if req.CalendarAligned != nil {
		group.CalendarAligned = *req.CalendarAligned
	}

	if err := h.configStore.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		// Persist scalar group fields (Session ensures BeforeSave validation runs).
		if err := tx.Save(&group).Error; err != nil {
			return err
		}
		// Replace tiers (and their mappings) when provided.
		if req.Tiers != nil {
			if err := deleteUserGroupTiers(tx, id); err != nil {
				return err
			}
			newTiers := buildUserGroupTiers(id, *req.Tiers)
			if len(newTiers) > 0 {
				if err := tx.Create(&newTiers).Error; err != nil {
					return err
				}
			}
		}
		// Replace members when provided.
		if req.VirtualKeyIDs != nil {
			if err := tx.Where("user_group_id = ?", id).Delete(&configstoreTables.TableUserGroupMember{}).Error; err != nil {
				return err
			}
			members := buildUserGroupMembers(id, *req.VirtualKeyIDs)
			if len(members) > 0 {
				if err := tx.Create(&members).Error; err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		SendError(ctx, 500, fmt.Sprintf("Failed to update user group: %v", err))
		return
	}

	if err := h.governanceManager.ReloadUserGroups(ctx); err != nil {
		SendError(ctx, 500, fmt.Sprintf("Failed to reload user groups in memory: %v, please restart bifrost to sync with the database", err))
		return
	}

	out, err := h.loadUserGroupWithRelations(ctx, id)
	if err != nil {
		out = &group
	}
	SendJSON(ctx, map[string]interface{}{
		"message":    "User group updated successfully",
		"user_group": out,
	})
}

// deleteUserGroup handles DELETE /api/governance/user-groups/{group_id}
func (h *GovernanceHandler) deleteUserGroup(ctx *fasthttp.RequestCtx) {
	id, _ := ctx.UserValue("group_id").(string)

	if err := h.configStore.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		if err := deleteUserGroupTiers(tx, id); err != nil {
			return err
		}
		if err := tx.Where("user_group_id = ?", id).Delete(&configstoreTables.TableUserGroupMember{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_group_id = ?", id).Delete(&configstoreTables.TableUserGroupUsage{}).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ?", id).Delete(&configstoreTables.TableUserGroup{}).Error; err != nil {
			return err
		}
		return nil
	}); err != nil {
		SendError(ctx, 500, fmt.Sprintf("Failed to delete user group: %v", err))
		return
	}

	if err := h.governanceManager.ReloadUserGroups(ctx); err != nil {
		logger.Error("failed to reload user groups after delete: %v", err)
	}

	SendJSON(ctx, map[string]interface{}{
		"message": "User group deleted successfully",
	})
}

// getUserGroupUsage handles GET /api/governance/user-groups/{group_id}/usage
// Returns the live per-member (per virtual key) window usage and active degradation tier.
func (h *GovernanceHandler) getUserGroupUsage(ctx *fasthttp.RequestCtx) {
	id, _ := ctx.UserValue("group_id").(string)

	usage, err := h.governanceManager.GetUserGroupUsage(ctx, id)
	if err != nil {
		SendError(ctx, 500, fmt.Sprintf("Failed to retrieve user group usage: %v", err))
		return
	}

	if h.tokenUsageSummarizer != nil {
		if group, loadErr := h.loadUserGroupWithRelations(ctx, id); loadErr == nil {
			h.reconcileUserGroupUsageFromLogs(ctx, usage, group)
		}
	}

	// Best-effort enrichment with virtual key names for display.
	names := make(map[string]string)
	db := h.configStore.ScopedDB(ctx)
	type vkRow struct {
		ID   string
		Name string
	}
	var rows []vkRow
	if len(usage) > 0 {
		ids := make([]string, 0, len(usage))
		for _, u := range usage {
			ids = append(ids, u.Identity)
		}
		if err := db.Table("governance_virtual_keys").Select("id", "name").Where("id IN ?", ids).Scan(&rows).Error; err == nil {
			for _, r := range rows {
				names[r.ID] = r.Name
			}
		}
	}

	type memberUsageResponse struct {
		governance.UserGroupMemberUsage
		VirtualKeyName string `json:"virtual_key_name,omitempty"`
	}
	enriched := make([]memberUsageResponse, 0, len(usage))
	for _, u := range usage {
		enriched = append(enriched, memberUsageResponse{UserGroupMemberUsage: u, VirtualKeyName: names[u.Identity]})
	}

	SendJSON(ctx, map[string]interface{}{
		"usage": enriched,
		"count": len(enriched),
	})
}

// resetUserGroupMemberUsage handles POST /api/governance/user-groups/{group_id}/usage/reset
func (h *GovernanceHandler) resetUserGroupMemberUsage(ctx *fasthttp.RequestCtx) {
	groupID, _ := ctx.UserValue("group_id").(string)

	var req ResetUserGroupMemberUsageRequest
	if err := sonic.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, 400, "Invalid JSON")
		return
	}
	identity := strings.TrimSpace(req.Identity)
	if identity == "" {
		SendError(ctx, 400, "identity is required")
		return
	}

	if err := h.governanceManager.ResetUserGroupMemberUsage(ctx, groupID, identity); err != nil {
		switch {
		case errors.Is(err, governance.ErrUserGroupNotFound):
			SendError(ctx, 404, "User group not found")
		case errors.Is(err, governance.ErrUserGroupMemberNotFound):
			SendError(ctx, 404, "Member not found in user group")
		default:
			SendError(ctx, 500, fmt.Sprintf("Failed to reset user group usage: %v", err))
		}
		return
	}

	SendJSON(ctx, map[string]interface{}{
		"message": "User group member usage reset successfully",
	})
}

// reconcileUserGroupUsageFromLogs merges per-window token_used with log aggregates
// over the same wall-clock window users see in Logs/Dashboard (e.g. last 5h).
// The live governance counter is preserved when it exceeds the log total.
func (h *GovernanceHandler) reconcileUserGroupUsageFromLogs(ctx context.Context, usage []governance.UserGroupMemberUsage, group *configstoreTables.TableUserGroup) {
	if h.tokenUsageSummarizer == nil || group == nil {
		return
	}
	now := time.Now()
	for i := range usage {
		member := &usage[i]
		var maxPct float64
		for j := range member.Windows {
			w := &member.Windows[j]
			windowStart, end, ok := governance.WindowUsageRange(group, w.Window, now)
			if !ok {
				continue
			}
			counter := w.TokenUsed
			if governance.ShouldUseGovernanceCounterForDisplay(windowStart, w.LastReset) {
				w.TokenUsed = counter
			} else {
				start := governance.LogUsageRangeStart(windowStart, w.LastReset)
				tokens, err := h.tokenUsageSummarizer.SumVirtualKeyTokens(ctx, member.Identity, start, end)
				if err != nil {
					continue
				}
				w.TokenUsed = governance.ReconcileTokenUsage(counter, tokens)
			}
			if w.TokenLimit != nil && *w.TokenLimit > 0 {
				w.PercentUsed = float64(w.TokenUsed) / float64(*w.TokenLimit) * 100
			} else {
				w.PercentUsed = 0
			}
			if w.PercentUsed > maxPct {
				maxPct = w.PercentUsed
			}
		}
		member.UsagePercent = maxPct
		if tier := governance.ActiveTierForUsagePercent(group, maxPct); tier != nil {
			order := tier.TierOrder
			threshold := tier.ThresholdPct
			member.ActiveTierOrder = &order
			member.ActiveTierThreshold = &threshold
			member.ActiveTierTerminal = tier.IsTerminal
		} else {
			member.ActiveTierOrder = nil
			member.ActiveTierThreshold = nil
			member.ActiveTierTerminal = false
		}
	}
}

// setUserGroupMembers handles PUT /api/governance/user-groups/{group_id}/members
func (h *GovernanceHandler) setUserGroupMembers(ctx *fasthttp.RequestCtx) {
	id, _ := ctx.UserValue("group_id").(string)

	var req SetUserGroupMembersRequest
	if err := sonic.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, 400, "Invalid JSON")
		return
	}

	db := h.configStore.ScopedDB(ctx)
	var group configstoreTables.TableUserGroup
	if err := db.First(&group, "id = ?", id).Error; err != nil {
		SendError(ctx, 404, "User group not found")
		return
	}

	if err := h.configStore.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		if err := tx.Where("user_group_id = ?", id).Delete(&configstoreTables.TableUserGroupMember{}).Error; err != nil {
			return err
		}
		members := buildUserGroupMembers(id, req.VirtualKeyIDs)
		if len(members) > 0 {
			if err := tx.Create(&members).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		SendError(ctx, 500, fmt.Sprintf("Failed to update user group members: %v", err))
		return
	}

	if err := h.governanceManager.ReloadUserGroups(ctx); err != nil {
		SendError(ctx, 500, fmt.Sprintf("Failed to reload user groups in memory: %v, please restart bifrost to sync with the database", err))
		return
	}

	out, err := h.loadUserGroupWithRelations(ctx, id)
	if err != nil {
		SendError(ctx, 500, "Failed to load updated user group")
		return
	}
	SendJSON(ctx, map[string]interface{}{
		"message":    "User group members updated successfully",
		"user_group": out,
	})
}

// buildUserGroupMembers builds membership rows, de-duplicating virtual key IDs.
func buildUserGroupMembers(groupID string, vkIDs []string) []configstoreTables.TableUserGroupMember {
	seen := make(map[string]struct{}, len(vkIDs))
	members := make([]configstoreTables.TableUserGroupMember, 0, len(vkIDs))
	for _, vkID := range vkIDs {
		if vkID == "" {
			continue
		}
		if _, ok := seen[vkID]; ok {
			continue
		}
		seen[vkID] = struct{}{}
		members = append(members, configstoreTables.TableUserGroupMember{
			UserGroupID:  groupID,
			VirtualKeyID: vkID,
		})
	}
	return members
}

// deleteUserGroupTiers removes all tiers and their mappings for a group within a tx.
func deleteUserGroupTiers(tx *gorm.DB, groupID string) error {
	var tierIDs []string
	if err := tx.Model(&configstoreTables.TableUserGroupTier{}).
		Where("user_group_id = ?", groupID).
		Pluck("id", &tierIDs).Error; err != nil {
		return err
	}
	if len(tierIDs) > 0 {
		if err := tx.Where("tier_id IN ?", tierIDs).Delete(&configstoreTables.TableUserGroupTierMapping{}).Error; err != nil {
			return err
		}
	}
	return tx.Where("user_group_id = ?", groupID).Delete(&configstoreTables.TableUserGroupTier{}).Error
}
