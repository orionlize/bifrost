package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strconv"
	"strings"
	"time"

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
	r.GET("/api/marketplace/items/{id}", lib.ChainMiddlewares(h.getItem, middlewares...))
	r.PUT("/api/marketplace/items/{id}", lib.ChainMiddlewares(h.updateItem, middlewares...))
	r.DELETE("/api/marketplace/items/{id}", lib.ChainMiddlewares(h.deleteItem, middlewares...))

	// Marketplace metadata
	r.GET("/api/marketplace/config", lib.ChainMiddlewares(h.getConfig, middlewares...))
	r.PUT("/api/marketplace/config", lib.ChainMiddlewares(h.updateConfig, middlewares...))

	// User assignment (admin)
	r.GET("/api/marketplace/users/{user_id}/assignments", lib.ChainMiddlewares(h.getUserAssignments, middlewares...))
	r.PUT("/api/marketplace/users/{user_id}/assignments", lib.ChainMiddlewares(h.replaceUserAssignments, middlewares...))
	r.POST("/api/marketplace/users/{user_id}/assignments", lib.ChainMiddlewares(h.addUserAssignments, middlewares...))
	r.DELETE("/api/marketplace/users/{user_id}/assignments/{item_id}", lib.ChainMiddlewares(h.removeUserAssignment, middlewares...))

	// Marketplace source (manifest + content)
	r.GET("/api/marketplace/manifest", lib.ChainMiddlewares(h.getPublicManifest, middlewares...))
	r.GET("/.claude-plugin/marketplace.json", lib.ChainMiddlewares(h.getPublicManifest, middlewares...))
	r.GET("/api/marketplace/my/manifest", lib.ChainMiddlewares(h.getMyManifest, middlewares...))
	r.GET("/api/marketplace/my/items", lib.ChainMiddlewares(h.getMyItems, middlewares...))
	r.GET("/marketplace/{item_type}/{name}/*", lib.ChainMiddlewares(h.serveItemContent, middlewares...))
}

type marketplaceItemRequest struct {
	Name        string                         `json:"name"`
	ItemType    schemas.MarketplaceItemType    `json:"item_type"`
	Description string                         `json:"description"`
	Version     string                         `json:"version"`
	Source      string                         `json:"source"`
	Enabled     *bool                          `json:"enabled"`
	Category    string                         `json:"category"`
	Tags        []string                       `json:"tags"`
	Content     *schemas.MarketplaceItemBundle `json:"content"`
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
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	var req marketplaceItemRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request body")
		return
	}
	if err := validateMarketplaceItemRequest(&req, true); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	item := &tables.TableMarketplaceItem{
		Name:        strings.TrimSpace(req.Name),
		ItemType:    req.ItemType,
		Description: strings.TrimSpace(req.Description),
		Version:     strings.TrimSpace(req.Version),
		Source:      strings.TrimSpace(req.Source),
		Enabled:     enabled,
		Category:    strings.TrimSpace(req.Category),
		Tags:        req.Tags,
		Content:     req.Content,
	}
	if item.Source == "" {
		item.Source = defaultMarketplaceItemSource(item)
	}

	if err := h.configStore.CreateMarketplaceItem(ctx, item); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to create marketplace item: %v", err))
		return
	}

	SendJSONWithStatus(ctx, map[string]any{"item": marketplaceItemResponse(item, true)}, fasthttp.StatusCreated)
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
	item.Description = strings.TrimSpace(req.Description)
	item.Version = strings.TrimSpace(req.Version)
	if strings.TrimSpace(req.Source) != "" {
		item.Source = strings.TrimSpace(req.Source)
	}
	if req.Enabled != nil {
		item.Enabled = *req.Enabled
	}
	item.Category = strings.TrimSpace(req.Category)
	if req.Tags != nil {
		item.Tags = req.Tags
	}
	if req.Content != nil {
		item.Content = req.Content
	}
	if item.Source == "" {
		item.Source = defaultMarketplaceItemSource(item)
	}

	if err := h.configStore.UpdateMarketplaceItem(ctx, item); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to update marketplace item: %v", err))
		return
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

func (h *MarketplaceHandler) getPublicManifest(ctx *fasthttp.RequestCtx) {
	cfg, err := h.configStore.GetMarketplaceConfig(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get marketplace config: %v", err))
		return
	}

	if cfg != nil && !cfg.PublicRead && !requireLocalAdmin(ctx, h.configStore) {
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
		SendJSON(ctx, configstore.BuildMarketplaceManifest(cfg, items))
		return
	}

	enabled := true
	items, _, err := h.configStore.GetMarketplaceItemsPaginated(ctx, configstore.MarketplaceItemsQueryParams{
		Enabled: &enabled,
		Limit:   10000,
	})
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to list marketplace items: %v", err))
		return
	}

	SendJSON(ctx, configstore.BuildMarketplaceManifest(cfg, items))
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

	SendJSON(ctx, configstore.BuildMarketplaceManifest(cfg, items))
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

func (h *MarketplaceHandler) serveItemContent(ctx *fasthttp.RequestCtx) {
	itemType := strings.TrimSpace(ctx.UserValue("item_type").(string))
	name := strings.TrimSpace(ctx.UserValue("name").(string))
	relPath := strings.TrimSpace(ctx.UserValue("*").(string))
	if name == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid item name")
		return
	}

	item, err := h.configStore.GetMarketplaceItemByName(ctx, name)
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

	cfg, err := h.configStore.GetMarketplaceConfig(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get marketplace config: %v", err))
		return
	}
	if cfg == nil || cfg.PublicRead {
		// public catalog — no auth required
	} else if !requireLocalAdmin(ctx, h.configStore) {
		aoneUserID, authErr := resolveMarketplaceAoneUserID(ctx, h.configStore)
		if authErr != nil {
			SendError(ctx, authErr.status, authErr.message)
			return
		}
		assigned, err := h.configStore.GetMarketplaceItemsForUser(ctx, aoneUserID)
		if err != nil {
			SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to verify assignment: %v", err))
			return
		}
		allowed := false
		for i := range assigned {
			if assigned[i].ID == item.ID {
				allowed = true
				break
			}
		}
		if !allowed {
			SendError(ctx, fasthttp.StatusForbidden, "Item not assigned to user")
			return
		}
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
	result := map[string]any{
		"id":          item.ID,
		"name":        item.Name,
		"item_type":   item.ItemType,
		"description": item.Description,
		"version":     item.Version,
		"source":      item.Source,
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
	switch item.ItemType {
	case schemas.MarketplaceItemTypeSkill:
		return fmt.Sprintf("./marketplace/skills/%s", item.Name)
	default:
		return fmt.Sprintf("./marketplace/plugins/%s", item.Name)
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
	return ".claude-plugin/plugin.json"
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

func resolveMarketplaceAoneUserID(ctx *fasthttp.RequestCtx, store configstore.ConfigStore) (string, *marketplaceAuthError) {
	token := strings.TrimSpace(sessionTokenFromRequest(ctx))
	if token == "" {
		return "", &marketplaceAuthError{fasthttp.StatusUnauthorized, "Authentication required"}
	}

	if strings.HasPrefix(token, configstore.AoneDeviceCredentialPrefix) {
		cred, err := store.ResolveActiveAoneDeviceTemporaryCredential(ctx, token)
		if err != nil {
			return "", &marketplaceAuthError{fasthttp.StatusUnauthorized, "Invalid or expired access token"}
		}
		aoneUserID := strings.TrimSpace(cred.AoneUserID)
		if aoneUserID == "" {
			return "", &marketplaceAuthError{fasthttp.StatusUnauthorized, "Invalid or expired access token"}
		}
		return aoneUserID, nil
	}

	session, err := store.GetSession(ctx, token)
	if err != nil || session == nil {
		return "", &marketplaceAuthError{fasthttp.StatusUnauthorized, "Invalid session"}
	}
	if session.ExpiresAt.Before(time.Now()) {
		return "", &marketplaceAuthError{fasthttp.StatusUnauthorized, "Session expired"}
	}
	if session.AoneUserID == nil || strings.TrimSpace(*session.AoneUserID) == "" {
		return "", &marketplaceAuthError{fasthttp.StatusNotFound, "No Aone user linked to this session"}
	}
	return strings.TrimSpace(*session.AoneUserID), nil
}
