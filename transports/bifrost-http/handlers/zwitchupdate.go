package handlers

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

// ZwitchUpdateHandler serves Tauri updater endpoints for the Zwitch desktop client.
type ZwitchUpdateHandler struct {
	configStore configstore.ConfigStore
}

// NewZwitchUpdateHandler creates a Zwitch update handler.
func NewZwitchUpdateHandler(configStore configstore.ConfigStore) *ZwitchUpdateHandler {
	return &ZwitchUpdateHandler{configStore: configStore}
}

// RegisterRoutes registers Zwitch updater routes.
func (h *ZwitchUpdateHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	r.GET("/api/aone/zwitch/updates/{target}/{arch}/{current_version}", lib.ChainMiddlewares(h.checkUpdate, middlewares...))
	r.GET("/api/aone/zwitch/update-config", lib.ChainMiddlewares(h.getConfig, middlewares...))
	r.PUT("/api/aone/zwitch/update-config", lib.ChainMiddlewares(h.updateConfig, middlewares...))
}

func (h *ZwitchUpdateHandler) checkUpdate(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		ctx.SetStatusCode(fasthttp.StatusNoContent)
		return
	}

	target, _ := ctx.UserValue("target").(string)
	arch, _ := ctx.UserValue("arch").(string)
	currentVersion, _ := ctx.UserValue("current_version").(string)

	cfg, err := h.configStore.GetTauriUpdateConfig(ctx)
	if err != nil {
		logger.Warn("[zwitch-update] failed to load config: %v", err)
		ctx.SetStatusCode(fasthttp.StatusNoContent)
		return
	}

	response, ok := configstore.BuildTauriUpdateResponse(cfg, target, arch, currentVersion)
	if !ok {
		ctx.SetStatusCode(fasthttp.StatusNoContent)
		return
	}
	SendJSON(ctx, response)
}

func (h *ZwitchUpdateHandler) getConfig(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store not available")
		return
	}

	cfg, err := h.configStore.GetTauriUpdateConfig(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get tauri update config: %v", err))
		return
	}
	SendJSON(ctx, map[string]any{"tauri_update": cfg})
}

func (h *ZwitchUpdateHandler) updateConfig(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store not available")
		return
	}

	var req schemas.TauriUpdateConfig
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request body")
		return
	}
	if err := validateTauriUpdateConfig(&req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}

	if err := h.configStore.UpdateTauriUpdateConfig(ctx, &req); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to update tauri update config: %v", err))
		return
	}
	SendJSON(ctx, map[string]any{"tauri_update": req})
}

func validateTauriUpdateConfig(cfg *schemas.TauriUpdateConfig) error {
	if cfg == nil {
		return fmt.Errorf("tauri update config is nil")
	}
	version := strings.TrimSpace(cfg.Version)
	if version == "" {
		for key, platform := range cfg.Platforms {
			if strings.TrimSpace(platform.URL) != "" || strings.TrimSpace(platform.Signature) != "" {
				return fmt.Errorf("version is required when platform %q has installer metadata", key)
			}
		}
		return nil
	}
	for key, platform := range cfg.Platforms {
		url := strings.TrimSpace(platform.URL)
		signature := strings.TrimSpace(platform.Signature)
		if url == "" && signature == "" {
			continue
		}
		if url == "" {
			return fmt.Errorf("platforms[%s].url is required", key)
		}
		if signature == "" {
			return fmt.Errorf("platforms[%s].signature is required", key)
		}
		if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
			return fmt.Errorf("platforms[%s].url must start with http:// or https://", key)
		}
	}
	hasPlatform := false
	for _, platform := range cfg.Platforms {
		if strings.TrimSpace(platform.URL) != "" && strings.TrimSpace(platform.Signature) != "" {
			hasPlatform = true
			break
		}
	}
	if !hasPlatform {
		return fmt.Errorf("at least one platform with url and signature is required when version is set")
	}
	return nil
}
