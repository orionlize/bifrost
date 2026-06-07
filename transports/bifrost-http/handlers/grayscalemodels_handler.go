package handlers

import (
	"fmt"
	"strings"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/modelcatalog"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

// listZwitchGrayscaleModels handles GET /api/aone/zwitch/grayscale-models.
//
// Returns builtin models (regular provider keys) plus additional_models (grayscale
// extras). Clients must use injection_mode=append: keep models and append
// additional_models to the picker — do not replace the existing model list.
//
// Query parameters:
//   - platform: optional filter (claude, codex, gemini, opencode)
//
// Authentication: Aone session token or device temporary credential (bf-tmp-...).
func (h *ProviderHandler) listZwitchGrayscaleModels(ctx *fasthttp.RequestCtx) {
	aoneUserID, authErr := resolveRequestAoneUserID(ctx, h.dbStore)
	if authErr != nil {
		SendError(ctx, authErr.status, authErr.message)
		return
	}

	platformFilter := strings.TrimSpace(string(ctx.QueryArgs().Peek("platform")))
	if platformFilter != "" {
		valid := false
		for _, def := range zwitchClientPlatforms {
			if def.ID == strings.ToLower(platformFilter) {
				valid = true
				break
			}
		}
		if !valid {
			SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("unsupported platform %q", platformFilter))
			return
		}
	}

	var providers map[schemas.ModelProvider]configstore.ProviderConfig
	if h.inMemoryStore != nil && len(h.inMemoryStore.Providers) > 0 {
		providers = h.inMemoryStore.Providers
	} else if h.dbStore != nil {
		var err error
		providers, err = h.dbStore.GetProvidersConfig(ctx)
		if err != nil {
			SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to load providers: %v", err))
			return
		}
	} else {
		SendJSON(ctx, ListGrayscaleModelsResponse{
			InjectionMode:   zwitchModelInjectionModeAppend,
			Platforms:       []GrayscalePlatformModels{},
			Total:           0,
			TotalBuiltin:    0,
			TotalAdditional: 0,
		})
		return
	}

	var catalog *modelcatalog.ModelCatalog
	if h.inMemoryStore != nil {
		catalog = h.inMemoryStore.ModelCatalog
	}

	response := collectGrayscaleModelsForUser(providers, catalog, aoneUserID, platformFilter)
	SendJSON(ctx, response)
}

// registerZwitchGrayscaleModelRoutes mounts Zwitch client grayscale model routes.
func (h *ProviderHandler) registerZwitchGrayscaleModelRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	r.GET("/api/aone/zwitch/grayscale-models", lib.ChainMiddlewares(h.listZwitchGrayscaleModels, middlewares...))
}
