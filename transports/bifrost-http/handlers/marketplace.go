package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strconv"
	"strings"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// MarketplaceHandler serves unified marketplace catalog, user assignment, and source APIs.
type MarketplaceHandler struct {
	configStore configstore.ConfigStore
}

// NewMarketplaceHandler creates a new marketplace handler.
func NewMarketplaceHandler(configStore configstore.ConfigStore) *MarketplaceHandler {
	if configStore == nil {
		return nil
	}
	return &MarketplaceHandler{configStore: configStore}
}

// RegisterRoutes registers marketplace management and source routes.
func (h *MarketplaceHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	// Admin catalog CRUD
	r.GET("/api/marketplace/items", lib.ChainMiddlewares(h.listItems, middlewares...))
	r.POST("/api/marketplace/items", lib.ChainMiddlewares(h.createItem, middlewares...))
	r.POST("/api/marketplace/items/import", lib.ChainMiddlewares(h.importItem, middlewares...))
	r.GET("/api/marketplace/catalog/presets", lib.ChainMiddlewares(h.listCatalogPresets, middlewares...))
	r.GET("/api/marketplace/catalog/preview", lib.ChainMiddlewares(h.previewCatalog, middlewares...))
	r.GET("/api/marketplace/items/{id}", lib.ChainMiddlewares(h.getItem, middlewares...))
	r.GET("/api/marketplace/items/{id}/icon", lib.ChainMiddlewares(h.serveItemIcon, middlewares...))
	r.PUT("/api/marketplace/items/{id}", lib.ChainMiddlewares(h.updateItem, middlewares...))
	r.POST("/api/marketplace/items/{id}/icon", lib.ChainMiddlewares(h.uploadItemIcon, middlewares...))
	r.POST("/api/marketplace/items/{id}/sync", lib.ChainMiddlewares(h.syncItem, middlewares...))
	r.DELETE("/api/marketplace/items/{id}", lib.ChainMiddlewares(h.deleteItem, middlewares...))

	// Marketplace metadata
	r.GET("/api/marketplace/config", lib.ChainMiddlewares(h.getConfig, middlewares...))
	r.PUT("/api/marketplace/config", lib.ChainMiddlewares(h.updateConfig, middlewares...))

	// User assignment (admin, legacy)
	r.GET("/api/marketplace/users/{user_id}/assignments", lib.ChainMiddlewares(h.getUserAssignments, middlewares...))
	r.PUT("/api/marketplace/users/{user_id}/assignments", lib.ChainMiddlewares(h.replaceUserAssignments, middlewares...))
	r.POST("/api/marketplace/users/{user_id}/assignments", lib.ChainMiddlewares(h.addUserAssignments, middlewares...))
	r.DELETE("/api/marketplace/users/{user_id}/assignments/{item_id}", lib.ChainMiddlewares(h.removeUserAssignment, middlewares...))

	// Item assignment (admin)
	r.GET("/api/marketplace/items/{id}/assignments", lib.ChainMiddlewares(h.getItemAssignments, middlewares...))
	r.PUT("/api/marketplace/items/{id}/assignments", lib.ChainMiddlewares(h.replaceItemAssignments, middlewares...))

	// Marketplace source (manifest + content)
	r.GET("/api/marketplace/manifest", lib.ChainMiddlewares(h.getAPIManifest, middlewares...))
	r.GET("/.claude-plugin/marketplace.json", lib.ChainMiddlewares(h.getClaudePublicManifest, middlewares...))
	r.GET("/.agents/plugins/marketplace.json", lib.ChainMiddlewares(h.getCodexPublicManifest, middlewares...))
	r.GET("/api/marketplace/my/manifest", lib.ChainMiddlewares(h.getMyManifest, middlewares...))
	r.GET("/api/marketplace/my/items", lib.ChainMiddlewares(h.getMyItems, middlewares...))
	r.GET("/api/marketplace/my/git-credentials", lib.ChainMiddlewares(h.getMyGitCredentials, middlewares...))
	r.PUT("/api/marketplace/my/git-credentials", lib.ChainMiddlewares(h.updateMyGitCredentials, middlewares...))
	r.GET("/marketplace/{platform}/{item_type}/{name}/*", lib.ChainMiddlewares(h.serveItemContent, middlewares...))
	r.GET("/marketplace/{item_type}/{name}/*", lib.ChainMiddlewares(h.serveLegacyItemContent, middlewares...))
}

type marketplaceItemRequest struct {
	Name        string                      `json:"name"`
	ItemType    schemas.MarketplaceItemType `json:"item_type"`
	Description *string                     `json:"description,omitempty"`
	Version     *string                     `json:"version,omitempty"`
	IconURL     string                      `json:"icon_url"`
	ClearIcon   bool                        `json:"clear_icon"`
	Enabled     *bool                       `json:"enabled"`
	Category    string                      `json:"category"`
	Tags        []string                    `json:"tags"`
	Users       []string                    `json:"users"`
	Departments []string                    `json:"departments"`
}

type replaceAssignmentsRequest struct {
	ItemIDs []uint `json:"item_ids"`
}

type addAssignmentsRequest struct {
	ItemIDs []uint `json:"item_ids"`
}

func (h *MarketplaceHandler) listItems(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	limit, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("limit")))
	offset, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("offset")))
	search := strings.TrimSpace(string(ctx.QueryArgs().Peek("search")))
	itemType := strings.TrimSpace(string(ctx.QueryArgs().Peek("item_type")))
	platform := strings.TrimSpace(string(ctx.QueryArgs().Peek("platform")))

	var enabledFilter *bool
	if enabledRaw := strings.TrimSpace(string(ctx.QueryArgs().Peek("enabled"))); enabledRaw != "" {
		enabled := enabledRaw == "true" || enabledRaw == "1"
		enabledFilter = &enabled
	}

	items, totalCount, err := h.configStore.GetMarketplaceItemsPaginated(ctx, configstore.MarketplaceItemsQueryParams{
		Limit:    limit,
		Offset:   offset,
		Search:   search,
		ItemType: itemType,
		Platform: platform,
		Enabled:  enabledFilter,
	})
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to list marketplace items: %v", err))
		return
	}

	result := make([]map[string]any, 0, len(items))
	for i := range items {
		result = append(result, marketplaceItemResponse(&items[i], false))
	}

	SendJSON(ctx, map[string]any{
		"items":       result,
		"total_count": totalCount,
		"limit":       limitOrDefault(limit),
		"offset":      maxOffset(offset),
	})
}

func (h *MarketplaceHandler) createItem(ctx *fasthttp.RequestCtx) {
	SendError(ctx, fasthttp.StatusBadRequest, "Use POST /api/marketplace/items/import with zip upload or git sync")
}

func (h *MarketplaceHandler) getItem(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	id, err := parseUintPathParam(ctx, "id")
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid item id")
		return
	}

	item, err := h.configStore.GetMarketplaceItemByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "Marketplace item not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get marketplace item: %v", err))
		return
	}

	SendJSON(ctx, map[string]any{"item": marketplaceItemResponse(item, true)})
}

func (h *MarketplaceHandler) updateItem(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	id, err := parseUintPathParam(ctx, "id")
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid item id")
		return
	}

	item, err := h.configStore.GetMarketplaceItemByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "Marketplace item not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get marketplace item: %v", err))
		return
	}

	var req marketplaceItemRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request body")
		return
	}
	if err := validateMarketplaceItemRequest(&req, false); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}

	if strings.TrimSpace(req.Name) != "" {
		item.Name = strings.TrimSpace(req.Name)
	}
	if req.ItemType != "" {
		item.ItemType = req.ItemType
	}
	if req.Description != nil {
		item.Description = strings.TrimSpace(*req.Description)
	}
	if req.Version != nil {
		item.Version = strings.TrimSpace(*req.Version)
	}
	if req.ClearIcon {
		item.IconURL = ""
		item.IconData = ""
		item.IconMediaType = ""
	} else if strings.TrimSpace(req.IconURL) != "" {
		item.IconURL = strings.TrimSpace(req.IconURL)
		item.IconData = ""
		item.IconMediaType = ""
	}
	if req.Enabled != nil {
		item.Enabled = *req.Enabled
	}
	item.Category = strings.TrimSpace(req.Category)
	if req.Tags != nil {
		item.Tags = req.Tags
	}
	if item.Source == "" {
		item.Source = defaultMarketplaceItemSource(item)
	}

	if err := h.configStore.UpdateMarketplaceItem(ctx, item); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to update marketplace item: %v", err))
		return
	}

	if req.Users != nil || req.Departments != nil {
		if err := h.configStore.ReplaceMarketplaceItemAssignments(ctx, id, &schemas.MarketplaceItemAssignmentsUpdate{
			Users:       req.Users,
			Departments: req.Departments,
		}); err != nil {
			SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to update item assignments: %v", err))
			return
		}
	}

	SendJSON(ctx, map[string]any{"item": marketplaceItemResponse(item, true)})
}

func (h *MarketplaceHandler) deleteItem(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	id, err := parseUintPathParam(ctx, "id")
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid item id")
		return
	}

	if err := h.configStore.DeleteMarketplaceItem(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "Marketplace item not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to delete marketplace item: %v", err))
		return
	}

	SendJSON(ctx, map[string]any{"success": true})
}

func (h *MarketplaceHandler) getConfig(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	cfg, err := h.configStore.GetMarketplaceConfig(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get marketplace config: %v", err))
		return
	}
	SendJSON(ctx, map[string]any{"marketplace": cfg})
}

func (h *MarketplaceHandler) updateConfig(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	var req schemas.MarketplaceConfig
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request body")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "name is required")
		return
	}
	for i, source := range req.CatalogSources {
		if strings.TrimSpace(source.Label) == "" {
			SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("catalog_sources[%d].label is required", i))
			return
		}
		if strings.TrimSpace(source.URL) == "" {
			SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("catalog_sources[%d].url is required", i))
			return
		}
	}

	if err := h.configStore.UpdateMarketplaceConfig(ctx, &req); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to update marketplace config: %v", err))
		return
	}
	SendJSON(ctx, map[string]any{"marketplace": req})
}

func (h *MarketplaceHandler) getUserAssignments(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	userID, ok := ctx.UserValue("user_id").(string)
	if !ok || strings.TrimSpace(userID) == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid user id")
		return
	}

	assignments, err := h.configStore.GetMarketplaceUserAssignments(ctx, userID)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get user assignments: %v", err))
		return
	}

	itemIDs := make([]uint, 0, len(assignments))
	for i := range assignments {
		itemIDs = append(itemIDs, assignments[i].ItemID)
	}

	items := make([]map[string]any, 0)
	if len(itemIDs) > 0 {
		allItems, _, err := h.configStore.GetMarketplaceItemsPaginated(ctx, configstore.MarketplaceItemsQueryParams{
			Limit: len(itemIDs),
		})
		if err != nil {
			SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to load assigned items: %v", err))
			return
		}
		allowed := map[uint]struct{}{}
		for _, id := range itemIDs {
			allowed[id] = struct{}{}
		}
		for i := range allItems {
			if _, ok := allowed[allItems[i].ID]; ok {
				items = append(items, marketplaceItemResponse(&allItems[i], false))
			}
		}
	}

	SendJSON(ctx, map[string]any{
		"user_id":  userID,
		"item_ids": itemIDs,
		"items":    items,
	})
}

func (h *MarketplaceHandler) replaceUserAssignments(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	userID, ok := ctx.UserValue("user_id").(string)
	if !ok || strings.TrimSpace(userID) == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid user id")
		return
	}

	var req replaceAssignmentsRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request body")
		return
	}

	if _, err := h.configStore.GetAoneUserByAoneID(ctx, userID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "User not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to verify user: %v", err))
		return
	}

	if err := h.configStore.ReplaceMarketplaceUserAssignments(ctx, userID, req.ItemIDs); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to replace user assignments: %v", err))
		return
	}

	SendJSON(ctx, map[string]any{
		"user_id":  userID,
		"item_ids": req.ItemIDs,
	})
}

func (h *MarketplaceHandler) addUserAssignments(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	userID, ok := ctx.UserValue("user_id").(string)
	if !ok || strings.TrimSpace(userID) == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid user id")
		return
	}

	var req addAssignmentsRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request body")
		return
	}

	if _, err := h.configStore.GetAoneUserByAoneID(ctx, userID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "User not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to verify user: %v", err))
		return
	}

	if err := h.configStore.AddMarketplaceUserAssignments(ctx, userID, req.ItemIDs); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to add user assignments: %v", err))
		return
	}

	assignments, err := h.configStore.GetMarketplaceUserAssignments(ctx, userID)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to list user assignments: %v", err))
		return
	}
	itemIDs := make([]uint, 0, len(assignments))
	for i := range assignments {
		itemIDs = append(itemIDs, assignments[i].ItemID)
	}

	SendJSON(ctx, map[string]any{
		"user_id":  userID,
		"item_ids": itemIDs,
	})
}

func (h *MarketplaceHandler) removeUserAssignment(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	userID, ok := ctx.UserValue("user_id").(string)
	if !ok || strings.TrimSpace(userID) == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid user id")
		return
	}
	itemID, err := parseUintPathParam(ctx, "item_id")
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid item id")
		return
	}

	if err := h.configStore.RemoveMarketplaceUserAssignment(ctx, userID, itemID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "Assignment not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to remove assignment: %v", err))
		return
	}

	SendJSON(ctx, map[string]any{"success": true})
}

func (h *MarketplaceHandler) getItemAssignments(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	id, err := parseUintPathParam(ctx, "id")
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid item id")
		return
	}

	if _, err := h.configStore.GetMarketplaceItemByID(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "Marketplace item not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get marketplace item: %v", err))
		return
	}

	assignments, err := h.configStore.GetMarketplaceItemAssignments(ctx, id)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get item assignments: %v", err))
		return
	}

	users := make([]string, 0)
	departments := make([]string, 0)
	for i := range assignments {
		switch assignments[i].TargetType {
		case tables.MarketplaceAssignmentTargetUser:
			users = append(users, assignments[i].TargetID)
		case tables.MarketplaceAssignmentTargetDepartment:
			departments = append(departments, assignments[i].TargetID)
		}
	}

	SendJSON(ctx, map[string]any{
		"item_id":     id,
		"users":       users,
		"departments": departments,
	})
}

func (h *MarketplaceHandler) replaceItemAssignments(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	id, err := parseUintPathParam(ctx, "id")
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid item id")
		return
	}

	if _, err := h.configStore.GetMarketplaceItemByID(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "Marketplace item not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get marketplace item: %v", err))
		return
	}

	var req schemas.MarketplaceItemAssignmentsUpdate
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request body")
		return
	}

	if err := h.configStore.ReplaceMarketplaceItemAssignments(ctx, id, &req); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to replace item assignments: %v", err))
		return
	}

	SendJSON(ctx, map[string]any{
		"item_id":     id,
		"users":       req.Users,
		"departments": req.Departments,
	})
}

func (h *MarketplaceHandler) getClaudePublicManifest(ctx *fasthttp.RequestCtx) {
	h.getPublicManifest(ctx, schemas.MarketplacePlatformClaude, true)
}

func (h *MarketplaceHandler) getCodexPublicManifest(ctx *fasthttp.RequestCtx) {
	h.getPublicManifest(ctx, schemas.MarketplacePlatformCodex, false)
}

func (h *MarketplaceHandler) getAPIManifest(ctx *fasthttp.RequestCtx) {
	platform := parseMarketplacePlatformQuery(ctx)
	claudeFormat := platform != schemas.MarketplacePlatformCodex
	h.getPublicManifest(ctx, platform, claudeFormat)
}

func (h *MarketplaceHandler) getPublicManifest(ctx *fasthttp.RequestCtx, platform schemas.MarketplacePlatform, claudeFormat bool) {
	cfg, err := h.configStore.GetMarketplaceConfig(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get marketplace config: %v", err))
		return
	}

	var items []tables.TableMarketplaceItem
	if requireLocalAdmin(ctx, h.configStore) {
		enabled := true
		items, _, err = h.configStore.GetMarketplaceItemsPaginated(ctx, configstore.MarketplaceItemsQueryParams{
			Enabled: &enabled,
			Limit:   10000,
		})
		if err != nil {
			SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to list marketplace items: %v", err))
			return
		}
	} else {
		aoneUserID, authErr := resolveMarketplaceAoneUserID(ctx, h.configStore)
		if authErr != nil {
			SendError(ctx, authErr.status, authErr.message)
			return
		}
		items, err = h.configStore.GetMarketplaceItemsForUser(ctx, aoneUserID)
		if err != nil {
			SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get user marketplace items: %v", err))
			return
		}
	}

	SendJSON(ctx, buildManifestResponse(cfg, filterMarketplaceItemsByPlatform(items, platform), claudeFormat))
}

func buildManifestResponse(cfg *schemas.MarketplaceConfig, items []tables.TableMarketplaceItem, claudeFormat bool) any {
	if claudeFormat {
		return configstore.BuildMarketplaceManifest(cfg, items)
	}
	return configstore.BuildCodexMarketplaceManifest(cfg, items)
}

func filterMarketplaceItemsByPlatform(items []tables.TableMarketplaceItem, platform schemas.MarketplacePlatform) []tables.TableMarketplaceItem {
	filtered := make([]tables.TableMarketplaceItem, 0, len(items))
	for i := range items {
		itemPlatform := items[i].Platform
		if itemPlatform == "" {
			itemPlatform = schemas.MarketplacePlatformClaude
		}
		if itemPlatform == platform {
			filtered = append(filtered, items[i])
		}
	}
	return filtered
}

func (h *MarketplaceHandler) getMyManifest(ctx *fasthttp.RequestCtx) {
	aoneUserID, authErr := resolveMarketplaceAoneUserID(ctx, h.configStore)
	if authErr != nil {
		SendError(ctx, authErr.status, authErr.message)
		return
	}

	cfg, err := h.configStore.GetMarketplaceConfig(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get marketplace config: %v", err))
		return
	}

	items, err := h.configStore.GetMarketplaceItemsForUser(ctx, aoneUserID)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get user marketplace items: %v", err))
		return
	}

	platform := parseMarketplacePlatformQuery(ctx)
	claudeFormat := platform != schemas.MarketplacePlatformCodex
	SendJSON(ctx, buildManifestResponse(cfg, filterMarketplaceItemsByPlatform(items, platform), claudeFormat))
}

func (h *MarketplaceHandler) getMyItems(ctx *fasthttp.RequestCtx) {
	aoneUserID, authErr := resolveMarketplaceAoneUserID(ctx, h.configStore)
	if authErr != nil {
		SendError(ctx, authErr.status, authErr.message)
		return
	}

	items, err := h.configStore.GetMarketplaceItemsForUser(ctx, aoneUserID)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get user marketplace items: %v", err))
		return
	}

	result := make([]map[string]any, 0, len(items))
	for i := range items {
		result = append(result, marketplaceItemResponse(&items[i], true))
	}

	SendJSON(ctx, map[string]any{
		"items": result,
		"count": len(result),
	})
}

func (h *MarketplaceHandler) serveLegacyItemContent(ctx *fasthttp.RequestCtx) {
	ctx.SetUserValue("platform", string(schemas.MarketplacePlatformClaude))
	h.serveItemContent(ctx)
}

func (h *MarketplaceHandler) serveItemContent(ctx *fasthttp.RequestCtx) {
	platform := parseMarketplacePlatformPath(ctx.UserValue("platform"))
	itemType := strings.TrimSpace(ctx.UserValue("item_type").(string))
	name := strings.TrimSpace(ctx.UserValue("name").(string))
	relPath := strings.TrimSpace(ctx.UserValue("*").(string))
	if name == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid item name")
		return
	}

	item, err := h.configStore.GetMarketplaceItemByNameAndPlatform(ctx, name, string(platform))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "Marketplace item not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get marketplace item: %v", err))
		return
	}
	if !item.Enabled {
		SendError(ctx, fasthttp.StatusNotFound, "Marketplace item not found")
		return
	}
	if expectedType := marketplacePathItemType(itemType); expectedType != "" && item.ItemType != expectedType {
		SendError(ctx, fasthttp.StatusNotFound, "Marketplace item not found")
		return
	}

	if authErr := h.requireMarketplaceItemAccess(ctx, item.ID); authErr != nil {
		SendError(ctx, authErr.status, authErr.message)
		return
	}

	content, contentType, ok := resolveMarketplaceContent(item, relPath)
	if !ok {
		SendError(ctx, fasthttp.StatusNotFound, "File not found")
		return
	}

	ctx.Response.Header.SetContentType(contentType)
	ctx.SetStatusCode(fasthttp.StatusOK)
	ctx.SetBodyString(content)
}

func marketplaceItemResponse(item *tables.TableMarketplaceItem, includeContent bool) map[string]any {
	platform := item.Platform
	if platform == "" {
		platform = schemas.MarketplacePlatformClaude
	}
	result := map[string]any{
		"id":          item.ID,
		"name":        item.Name,
		"platform":    platform,
		"item_type":   item.ItemType,
		"description": item.Description,
		"version":     item.Version,
		"source_type": item.SourceType,
		"remote_url":  item.RemoteURL,
		"remote_ref":  item.RemoteRef,
		"icon_url":    marketplaceIconSrc(item),
		"enabled":     item.Enabled,
		"category":    item.Category,
		"tags":        item.Tags,
		"created_at":  item.CreatedAt,
		"updated_at":  item.UpdatedAt,
	}
	if includeContent && item.Content != nil {
		result["content"] = item.Content
	}
	return result
}

func validateMarketplaceItemRequest(req *marketplaceItemRequest, isCreate bool) error {
	if req == nil {
		return fmt.Errorf("request is nil")
	}
	if isCreate {
		if strings.TrimSpace(req.Name) == "" {
			return fmt.Errorf("name is required")
		}
		if req.ItemType != schemas.MarketplaceItemTypeSkill && req.ItemType != schemas.MarketplaceItemTypePlugin {
			return fmt.Errorf("item_type must be skill or plugin")
		}
	} else if req.ItemType != "" && req.ItemType != schemas.MarketplaceItemTypeSkill && req.ItemType != schemas.MarketplaceItemTypePlugin {
		return fmt.Errorf("item_type must be skill or plugin")
	}
	return nil
}

func defaultMarketplaceItemSource(item *tables.TableMarketplaceItem) string {
	if item == nil {
		return ""
	}
	return configstoreDefaultMarketplaceSource(*item)
}

func configstoreDefaultMarketplaceSource(item tables.TableMarketplaceItem) string {
	platformSegment := "claude"
	if item.Platform == schemas.MarketplacePlatformCodex {
		platformSegment = "codex"
	}
	switch item.ItemType {
	case schemas.MarketplaceItemTypeSkill:
		return fmt.Sprintf("./marketplace/%s/skills/%s", platformSegment, item.Name)
	default:
		return fmt.Sprintf("./marketplace/%s/plugins/%s", platformSegment, item.Name)
	}
}

func marketplacePathItemType(itemType string) schemas.MarketplaceItemType {
	switch strings.ToLower(strings.TrimSpace(itemType)) {
	case "skills", "skill":
		return schemas.MarketplaceItemTypeSkill
	case "plugins", "plugin":
		return schemas.MarketplaceItemTypePlugin
	default:
		return ""
	}
}

func resolveMarketplaceContent(item *tables.TableMarketplaceItem, relPath string) (string, string, bool) {
	if item == nil {
		return "", "", false
	}
	relPath = strings.TrimPrefix(path.Clean("/"+relPath), "/")
	if relPath == "." || relPath == "/" || relPath == "" {
		relPath = defaultMarketplaceContentPath(item)
	}

	if item.Content != nil {
		if relPath == "SKILL.md" && item.ItemType == schemas.MarketplaceItemTypeSkill && item.Content.SkillMD != "" {
			return item.Content.SkillMD, "text/markdown; charset=utf-8", true
		}
		if relPath == ".claude-plugin/plugin.json" && item.Content.PluginJSON != nil {
			data, err := json.Marshal(item.Content.PluginJSON)
			if err == nil {
				return string(data), "application/json; charset=utf-8", true
			}
		}
		if relPath == ".codex-plugin/plugin.json" && item.Content.PluginJSON != nil {
			data, err := json.Marshal(item.Content.PluginJSON)
			if err == nil {
				return string(data), "application/json; charset=utf-8", true
			}
		}
		if item.Content.Files != nil {
			if content, ok := item.Content.Files[relPath]; ok {
				return content, marketplaceContentType(relPath), true
			}
		}
	}

	// Synthesize default files when content is sparse.
	switch relPath {
	case ".claude-plugin/plugin.json":
		pluginJSON := map[string]any{
			"name":        item.Name,
			"description": item.Description,
			"version":     fallbackVersion(item.Version),
		}
		if item.Content != nil && item.Content.PluginJSON != nil {
			pluginJSON = item.Content.PluginJSON
		}
		data, err := json.Marshal(pluginJSON)
		if err != nil {
			return "", "", false
		}
		return string(data), "application/json; charset=utf-8", true
	case ".codex-plugin/plugin.json":
		pluginJSON := map[string]any{
			"name":        item.Name,
			"description": item.Description,
			"version":     fallbackVersion(item.Version),
		}
		if item.Content != nil && item.Content.PluginJSON != nil {
			pluginJSON = item.Content.PluginJSON
		}
		data, err := json.Marshal(pluginJSON)
		if err != nil {
			return "", "", false
		}
		return string(data), "application/json; charset=utf-8", true
	case "SKILL.md":
		if item.ItemType == schemas.MarketplaceItemTypeSkill {
			skillMD := fmt.Sprintf("---\nname: %s\ndescription: %s\n---\n", item.Name, item.Description)
			if item.Content != nil && item.Content.SkillMD != "" {
				skillMD = item.Content.SkillMD
			}
			return skillMD, "text/markdown; charset=utf-8", true
		}
	}
	return "", "", false
}

func defaultMarketplaceContentPath(item *tables.TableMarketplaceItem) string {
	if item.ItemType == schemas.MarketplaceItemTypeSkill {
		return "SKILL.md"
	}
	if item.Platform == schemas.MarketplacePlatformCodex {
		return ".codex-plugin/plugin.json"
	}
	return ".claude-plugin/plugin.json"
}

func parseMarketplacePlatformPath(raw any) schemas.MarketplacePlatform {
	value, _ := raw.(string)
	return parseMarketplacePlatform(value)
}

func parseMarketplacePlatformQuery(ctx *fasthttp.RequestCtx) schemas.MarketplacePlatform {
	return parseMarketplacePlatform(string(ctx.QueryArgs().Peek("platform")))
}

func parseMarketplacePlatform(value string) schemas.MarketplacePlatform {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(schemas.MarketplacePlatformCodex):
		return schemas.MarketplacePlatformCodex
	default:
		return schemas.MarketplacePlatformClaude
	}
}

func marketplaceContentType(relPath string) string {
	if strings.HasSuffix(strings.ToLower(relPath), ".json") {
		return "application/json; charset=utf-8"
	}
	return "text/markdown; charset=utf-8"
}

func fallbackVersion(version string) string {
	if strings.TrimSpace(version) == "" {
		return "1.0.0"
	}
	return version
}

func parseUintPathParam(ctx *fasthttp.RequestCtx, key string) (uint, error) {
	raw, ok := ctx.UserValue(key).(string)
	if !ok || strings.TrimSpace(raw) == "" {
		return 0, fmt.Errorf("missing path param")
	}
	parsed, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return 0, err
	}
	return uint(parsed), nil
}

type marketplaceAuthError struct {
	status  int
	message string
}

func (h *MarketplaceHandler) requireMarketplaceItemAccess(ctx *fasthttp.RequestCtx, itemID uint) *marketplaceAuthError {
	if requireLocalAdmin(ctx, h.configStore) {
		return nil
	}
	aoneUserID, authErr := resolveMarketplaceAoneUserID(ctx, h.configStore)
	if authErr != nil {
		return authErr
	}
	assigned, err := h.configStore.GetMarketplaceItemsForUser(ctx, aoneUserID)
	if err != nil {
		return &marketplaceAuthError{fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to verify assignment: %v", err)}
	}
	for i := range assigned {
		if assigned[i].ID == itemID {
			return nil
		}
	}
	return &marketplaceAuthError{fasthttp.StatusForbidden, "Item not assigned to user"}
}

func resolveMarketplaceAoneUserID(ctx *fasthttp.RequestCtx, store configstore.ConfigStore) (string, *marketplaceAuthError) {
	userID, status, message := resolveAoneUserIDFromToken(ctx, store)
	if status != 0 {
		return "", &marketplaceAuthError{status, message}
	}
	return userID, nil
}
