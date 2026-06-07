package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/aoneoauth"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// AoneUsersHandler serves Aone OAuth user management APIs.
type AoneUsersHandler struct {
	configStore configstore.ConfigStore
	vkReloader  VirtualKeyReloader
}

// NewAoneUsersHandler creates a new Aone users handler.
func NewAoneUsersHandler(configStore configstore.ConfigStore, vkReloader VirtualKeyReloader) *AoneUsersHandler {
	return &AoneUsersHandler{
		configStore: configStore,
		vkReloader:  vkReloader,
	}
}

// RegisterRoutes registers Aone user management routes.
func (h *AoneUsersHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	r.GET("/api/aone/users", lib.ChainMiddlewares(h.listUsers, middlewares...))
	r.GET("/api/aone/users/me", lib.ChainMiddlewares(h.getCurrentUser, middlewares...))
	r.GET("/api/aone/users/{id}", lib.ChainMiddlewares(h.getUser, middlewares...))
	r.PUT("/api/aone/users/{id}", lib.ChainMiddlewares(h.updateUser, middlewares...))
	r.POST("/api/aone/users/{id}/rotate-api-key", lib.ChainMiddlewares(h.rotateApiKey, middlewares...))
	r.GET("/api/aone/departments", lib.ChainMiddlewares(h.listDepartments, middlewares...))
	r.GET("/api/aone/departments/tree", lib.ChainMiddlewares(h.listDepartmentTree, middlewares...))
}

type updateAoneUserRequest struct {
	IsDisabled *bool `json:"is_disabled"`
}

func (h *AoneUsersHandler) listUsers(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	limit, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("limit")))
	offset, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("offset")))
	search := strings.TrimSpace(string(ctx.QueryArgs().Peek("search")))

	users, totalCount, err := h.configStore.GetAoneUsersPaginated(ctx, configstore.AoneUsersQueryParams{
		Limit:  limit,
		Offset: offset,
		Search: search,
	})
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to list Aone users: %v", err))
		return
	}

	items := make([]map[string]any, 0, len(users))
	for i := range users {
		items = append(items, aoneUserListItem(&users[i]))
	}

	SendJSON(ctx, map[string]any{
		"users":       items,
		"total_count": totalCount,
		"limit":       limitOrDefault(limit),
		"offset":      maxOffset(offset),
	})
}

func (h *AoneUsersHandler) listDepartments(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	limit, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("limit")))
	offset, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("offset")))
	search := strings.TrimSpace(string(ctx.QueryArgs().Peek("search")))

	departments, totalCount, err := h.configStore.GetAoneDepartmentsPaginated(ctx, configstore.AoneDepartmentsQueryParams{
		Limit:  limit,
		Offset: offset,
		Search: search,
	})
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to list departments: %v", err))
		return
	}

	items := make([]map[string]any, 0, len(departments))
	for i := range departments {
		item := map[string]any{
			"dept_id": departments[i].DeptID,
			"name":    departments[i].Name,
		}
		if departments[i].ParentDeptID != nil {
			item["parent_dept_id"] = *departments[i].ParentDeptID
		}
		if departments[i].FullPath != "" {
			item["full_path"] = departments[i].FullPath
		}
		items = append(items, item)
	}

	SendJSON(ctx, map[string]any{
		"departments": items,
		"total_count": totalCount,
		"limit":       limitOrDefault(limit),
		"offset":      maxOffset(offset),
	})
}

func (h *AoneUsersHandler) listDepartmentTree(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	tree, err := h.configStore.GetAoneDepartmentTree(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to list department tree: %v", err))
		return
	}

	SendJSON(ctx, map[string]any{
		"departments": tree,
	})
}

func (h *AoneUsersHandler) getUser(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	id, ok := ctx.UserValue("id").(string)
	if !ok || id == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid user id")
		return
	}

	user, err := h.configStore.GetAoneUserByAoneID(ctx, id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			SendError(ctx, fasthttp.StatusNotFound, "User not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get Aone user: %v", err))
		return
	}

	SendJSON(ctx, h.aoneUserDetailResponse(ctx, user, nil))
}

func (h *AoneUsersHandler) updateUser(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	id, ok := ctx.UserValue("id").(string)
	if !ok || id == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid user id")
		return
	}

	var req updateAoneUserRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid JSON")
		return
	}
	if req.IsDisabled == nil {
		SendError(ctx, fasthttp.StatusBadRequest, "is_disabled is required")
		return
	}

	user, err := h.configStore.SetAoneUserDisabled(ctx, id, *req.IsDisabled)
	if err != nil {
		if err == gorm.ErrRecordNotFound || errors.Is(err, configstore.ErrNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "User not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to update Aone user: %v", err))
		return
	}

	if user.VirtualKeyID != nil && *user.VirtualKeyID != "" && h.vkReloader != nil {
		if _, reloadErr := h.vkReloader.ReloadVirtualKey(ctx, *user.VirtualKeyID); reloadErr != nil {
			logger.Warn("[aone-users] failed to reload user API key after disable toggle: %v", reloadErr)
		} else {
			MarkAoneVirtualKeyReloaded(*user.VirtualKeyID)
		}
	}

	SendJSON(ctx, h.aoneUserDetailResponse(ctx, user, nil))
}

func (h *AoneUsersHandler) rotateApiKey(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	id, ok := ctx.UserValue("id").(string)
	if !ok || id == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid user id")
		return
	}

	vk, err := h.configStore.RotateAoneUserVirtualKey(ctx, id)
	if err != nil {
		if errors.Is(err, configstore.ErrAoneUserDisabled) {
			SendError(ctx, fasthttp.StatusForbidden, "User account is disabled")
			return
		}
		if err == gorm.ErrRecordNotFound || errors.Is(err, configstore.ErrNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "User or API key not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to rotate API key: %v", err))
		return
	}

	if vk != nil && h.vkReloader != nil {
		if _, reloadErr := h.vkReloader.ReloadVirtualKey(ctx, vk.ID); reloadErr != nil {
			logger.Warn("[aone-users] failed to reload user API key after rotate: %v", reloadErr)
		} else {
			MarkAoneVirtualKeyReloaded(vk.ID)
		}
	}

	user, err := h.configStore.GetAoneUserByAoneID(ctx, id)
	if err != nil {
		SendJSON(ctx, map[string]any{
			"message":        "API key rotated successfully",
			"api_key":        vk.Value,
			"api_key_active": true,
		})
		return
	}

	SendJSON(ctx, h.aoneUserDetailResponse(ctx, user, vk))
}

func (h *AoneUsersHandler) getCurrentUser(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}

	aoneUserID, authErr := resolveRequestAoneUserID(ctx, h.configStore)
	if authErr != nil {
		SendError(ctx, authErr.status, authErr.message)
		return
	}

	user, err := h.configStore.GetAoneUserByAoneID(ctx, aoneUserID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			SendError(ctx, fasthttp.StatusNotFound, "User not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get current Aone user: %v", err))
		return
	}
	if user.IsDisabled {
		SendError(ctx, fasthttp.StatusForbidden, "User account is disabled")
		return
	}

	vk, err := h.configStore.EnsureAoneUserVirtualKey(ctx, user.AoneUserID)
	if err != nil {
		if errors.Is(err, configstore.ErrAoneUserDisabled) {
			SendError(ctx, fasthttp.StatusForbidden, "User account is disabled")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to ensure user account: %v", err))
		return
	}
	if vk != nil && h.vkReloader != nil {
		if _, reloadErr := h.vkReloader.ReloadVirtualKey(ctx, vk.ID); reloadErr != nil {
			logger.Warn("[aone-oauth] failed to reload user virtual key for /me: %v", reloadErr)
		} else {
			MarkAoneVirtualKeyReloaded(vk.ID)
		}
	}

	SendJSON(ctx, h.aoneUserDetailResponse(ctx, user, vk))
}

func (h *AoneUsersHandler) aoneUserDetailResponse(ctx *fasthttp.RequestCtx, user *tables.AoneUserTable, vk *tables.TableVirtualKey) map[string]any {
	result := aoneUserDetail(user)
	if vk == nil && user.VirtualKeyID != nil && *user.VirtualKeyID != "" && h.configStore != nil {
		loaded, err := h.configStore.GetVirtualKey(ctx, *user.VirtualKeyID)
		if err == nil && loaded != nil {
			vk = loaded
		}
	}
	attachAoneUserAPIKeyFields(result, user, vk)
	return result
}

func sessionTokenFromRequest(ctx *fasthttp.RequestCtx) string {
	if authHeader := string(ctx.Request.Header.Peek("Authorization")); strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimPrefix(authHeader, "Bearer ")
	}
	return string(ctx.Request.Header.Cookie("token"))
}

func aoneUserListItem(user *tables.AoneUserTable) map[string]any {
	item := map[string]any{
		"id":               user.AoneUserID,
		"email":            user.Email,
		"name":             user.Name,
		"avatar":           user.Avatar,
		"display_name":     user.DisplayName,
		"display_avatar":   user.DisplayAvatar,
		"status":           user.Status,
		"email_verified":   user.EmailVerified,
		"department_names": user.DepartmentNames,
		"job_title":        user.JobTitle,
		"last_login_at":    user.LastLoginAt,
		"login_count":      user.LoginCount,
		"is_disabled":      user.IsDisabled,
	}
	if user.UserCreatedAt != nil {
		item["created_at"] = user.UserCreatedAt
	}
	if depts := decodeAoneDepartments(user.DingtalkJSON); depts != nil {
		item["departments"] = depts
	}
	return item
}

func aoneUserDetail(user *tables.AoneUserTable) map[string]any {
	result := map[string]any{
		"user": map[string]any{
			"id":             user.AoneUserID,
			"email":          user.Email,
			"name":           user.Name,
			"avatar":         user.Avatar,
			"display_name":   user.DisplayName,
			"display_avatar": user.DisplayAvatar,
			"status":         user.Status,
			"email_verified": user.EmailVerified,
		},
		"last_login_at":     user.LastLoginAt,
		"login_count":       user.LoginCount,
		"record_created_at": user.CreatedAt,
		"updated_at":        user.UpdatedAt,
		"is_disabled":       user.IsDisabled,
	}
	if user.UserCreatedAt != nil {
		result["user"].(map[string]any)["created_at"] = user.UserCreatedAt
	}
	if user.DingtalkJSON != "" {
		var dingtalk aoneoauth.DingtalkInfo
		if err := json.Unmarshal([]byte(user.DingtalkJSON), &dingtalk); err == nil {
			result["dingtalk"] = map[string]any{
				"profile":     dingtalk.Profile,
				"departments": dingtalk.DepartmentsForResponse(),
				"syncedAt":    dingtalk.SyncedAt,
			}
		}
	}
	if user.ApplicationJSON != "" {
		var application aoneoauth.ApplicationInfo
		if err := json.Unmarshal([]byte(user.ApplicationJSON), &application); err == nil {
			result["application"] = application
		}
	}
	return result
}

func attachAoneUserAPIKeyFields(result map[string]any, user *tables.AoneUserTable, vk *tables.TableVirtualKey) {
	if vk == nil {
		return
	}
	if vk.Value != "" {
		result["api_key"] = vk.Value
	}
	result["api_key_active"] = vk.IsActiveValue()
}

func decodeAoneDepartments(dingtalkJSON string) any {
	if dingtalkJSON == "" {
		return nil
	}
	var dingtalk aoneoauth.DingtalkInfo
	if err := json.Unmarshal([]byte(dingtalkJSON), &dingtalk); err != nil {
		return nil
	}
	depts := dingtalk.DepartmentsForResponse()
	if depts == nil {
		return nil
	}
	switch typed := depts.(type) {
	case []aoneoauth.DingtalkDepartment:
		if len(typed) == 0 {
			return nil
		}
	case [][]aoneoauth.DingtalkDepartment:
		if len(typed) == 0 {
			return nil
		}
	case []aoneoauth.DingtalkDepartmentAssignment:
		if len(typed) == 0 {
			return nil
		}
	}
	return depts
}

func limitOrDefault(limit int) int {
	if limit <= 0 {
		return 25
	}
	return limit
}

func maxOffset(offset int) int {
	if offset < 0 {
		return 0
	}
	return offset
}
