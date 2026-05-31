package handlers

import (
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

type GlobalAPIKeysHandler struct {
	configStore configstore.ConfigStore
}

func NewGlobalAPIKeysHandler(configStore configstore.ConfigStore) *GlobalAPIKeysHandler {
	return &GlobalAPIKeysHandler{configStore: configStore}
}

func (h *GlobalAPIKeysHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	r.GET("/api/settings/api-keys", lib.ChainMiddlewares(h.list, middlewares...))
	r.POST("/api/settings/api-keys", lib.ChainMiddlewares(h.create, middlewares...))
	r.PUT("/api/settings/api-keys/{id}", lib.ChainMiddlewares(h.update, middlewares...))
	r.DELETE("/api/settings/api-keys/{id}", lib.ChainMiddlewares(h.delete, middlewares...))
}

func (h *GlobalAPIKeysHandler) list(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	keys, err := h.configStore.ListGlobalAPIKeys(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to list global API keys: %v", err))
		return
	}
	SendJSON(ctx, map[string]any{"api_keys": keys})
}

type createGlobalAPIKeyRequest struct {
	Name string `json:"name"`
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

	key, token, err := h.configStore.CreateGlobalAPIKey(ctx, req.Name)
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}

	SendJSON(ctx, map[string]any{
		"api_key": key,
		"token":   token,
	})
}

type updateGlobalAPIKeyRequest struct {
	IsActive *bool `json:"is_active"`
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
	if req.IsActive == nil {
		SendError(ctx, fasthttp.StatusBadRequest, "is_active is required")
		return
	}

	key, err := h.configStore.SetGlobalAPIKeyActive(ctx, id, *req.IsActive)
	if err != nil {
		if errors.Is(err, configstore.ErrGlobalAPIKeyNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "API key not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to update API key: %v", err))
		return
	}

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

	SendJSON(ctx, map[string]any{"message": "API key deleted"})
}
