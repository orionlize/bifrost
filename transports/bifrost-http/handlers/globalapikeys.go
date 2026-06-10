package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

// GlobalAPIKeyCacheRefresher reloads in-memory global API key metadata used by routing rules.
type GlobalAPIKeyCacheRefresher interface {
	ReloadGlobalAPIKeys(ctx context.Context) error
}

type GlobalAPIKeysHandler struct {
	configStore    configstore.ConfigStore
	cacheRefresher GlobalAPIKeyCacheRefresher
}

func NewGlobalAPIKeysHandler(configStore configstore.ConfigStore, cacheRefresher GlobalAPIKeyCacheRefresher) *GlobalAPIKeysHandler {
	return &GlobalAPIKeysHandler{configStore: configStore, cacheRefresher: cacheRefresher}
}

func (h *GlobalAPIKeysHandler) refreshGlobalAPIKeyCache(ctx context.Context) {
	if h.cacheRefresher == nil {
		return
	}
	if err := h.cacheRefresher.ReloadGlobalAPIKeys(ctx); err != nil {
		logger.Warn("failed to reload global api key cache for routing: %v", err)
	}
}

func (h *GlobalAPIKeysHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	r.GET("/api/settings/api-keys", lib.ChainMiddlewares(h.list, middlewares...))
	r.GET("/api/settings/api-keys/access", lib.ChainMiddlewares(h.access, middlewares...))
	r.GET("/api/settings/api-keys/access/{id}/token", lib.ChainMiddlewares(h.accessToken, middlewares...))
	r.POST("/api/settings/api-keys", lib.ChainMiddlewares(h.create, middlewares...))
	r.POST("/api/settings/api-keys/{id}/rotate-token", lib.ChainMiddlewares(h.rotateToken, middlewares...))
	r.PUT("/api/settings/api-keys/{id}", lib.ChainMiddlewares(h.update, middlewares...))
	r.DELETE("/api/settings/api-keys/{id}", lib.ChainMiddlewares(h.delete, middlewares...))
}

func (h *GlobalAPIKeysHandler) list(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireDashboardSession(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Authentication required")
		return
	}

	keys, err := h.configStore.ListGlobalAPIKeys(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to list API keys: %v", err))
		return
	}
	SendJSON(ctx, map[string]any{"api_keys": keys})
}

func (h *GlobalAPIKeysHandler) access(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireDashboardSession(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Authentication required")
		return
	}

	aoneUserID, authErr := resolveRequestAoneUserID(ctx, h.configStore)
	if authErr != nil {
		SendJSON(ctx, map[string]any{
			"has_access": false,
			"api_keys":   []any{},
		})
		return
	}

	keys, err := h.configStore.ListAssignedGlobalAPIKeysForUser(ctx, aoneUserID)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to resolve API key access: %v", err))
		return
	}

	SendJSON(ctx, map[string]any{
		"has_access": len(keys) > 0,
		"api_keys":   configstore.ToGlobalAPIKeyAccessItems(keys),
	})
}

func (h *GlobalAPIKeysHandler) accessToken(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireDashboardSession(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Authentication required")
		return
	}

	aoneUserID, authErr := resolveRequestAoneUserID(ctx, h.configStore)
	if authErr != nil {
		SendError(ctx, authErr.status, authErr.message)
		return
	}

	id, ok := ctx.UserValue("id").(string)
	if !ok || strings.TrimSpace(id) == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid API key id")
		return
	}

	token, err := h.configStore.GetAssignedGlobalAPIKeyToken(ctx, aoneUserID, id)
	if err != nil {
		if errors.Is(err, configstore.ErrGlobalAPIKeyNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "API key not found")
			return
		}
		if errors.Is(err, configstore.ErrGlobalAPIKeyTokenUnavailable) {
			SendError(ctx, fasthttp.StatusNotFound, "API key token unavailable")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to resolve API key token: %v", err))
		return
	}

	SendJSON(ctx, map[string]any{"token": token})
}

func (h *GlobalAPIKeysHandler) rotateToken(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	id, ok := ctx.UserValue("id").(string)
	if !ok || strings.TrimSpace(id) == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid API key id")
		return
	}

	key, token, err := h.configStore.RotateGlobalAPIKeyToken(ctx, id)
	if err != nil {
		if errors.Is(err, configstore.ErrGlobalAPIKeyNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "API key not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to rotate API key token: %v", err))
		return
	}

	h.refreshGlobalAPIKeyCache(ctx)

	SendJSON(ctx, map[string]any{
		"api_key": key,
		"token":   token,
	})
}

type createGlobalAPIKeyRequest struct {
	Name           string   `json:"name"`
	AllowedUserIDs []string `json:"allowed_user_ids"`
}

func (h *GlobalAPIKeysHandler) create(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	var req createGlobalAPIKeyRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid JSON")
		return
	}

	key, token, err := h.configStore.CreateGlobalAPIKey(ctx, req.Name, req.AllowedUserIDs)
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}

	h.refreshGlobalAPIKeyCache(ctx)

	SendJSON(ctx, map[string]any{
		"api_key": key,
		"token":   token,
	})
}

type updateGlobalAPIKeyRequest struct {
	IsActive       *bool     `json:"is_active"`
	AllowedUserIDs *[]string `json:"allowed_user_ids"`
}

func (h *GlobalAPIKeysHandler) update(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	id, ok := ctx.UserValue("id").(string)
	if !ok || strings.TrimSpace(id) == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid API key id")
		return
	}

	var req updateGlobalAPIKeyRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid JSON")
		return
	}
	if req.IsActive == nil && req.AllowedUserIDs == nil {
		SendError(ctx, fasthttp.StatusBadRequest, "is_active or allowed_user_ids is required")
		return
	}

	key, err := h.configStore.UpdateGlobalAPIKey(ctx, id, configstore.GlobalAPIKeyUpdate{
		IsActive:       req.IsActive,
		AllowedUserIDs: req.AllowedUserIDs,
	})
	if err != nil {
		if errors.Is(err, configstore.ErrGlobalAPIKeyNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "API key not found")
			return
		}
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}

	h.refreshGlobalAPIKeyCache(ctx)

	SendJSON(ctx, map[string]any{"api_key": key})
}

func (h *GlobalAPIKeysHandler) delete(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	id, ok := ctx.UserValue("id").(string)
	if !ok || strings.TrimSpace(id) == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid API key id")
		return
	}

	if err := h.configStore.DeleteGlobalAPIKey(ctx, id); err != nil {
		if errors.Is(err, configstore.ErrGlobalAPIKeyNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "API key not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to delete API key: %v", err))
		return
	}

	h.refreshGlobalAPIKeyCache(ctx)

	SendJSON(ctx, map[string]any{"message": "API key deleted"})
}
