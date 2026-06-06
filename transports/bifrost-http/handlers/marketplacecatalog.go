package handlers

import (
	"strings"

	"github.com/maximhq/bifrost/framework/marketplace"
	"github.com/valyala/fasthttp"
)

func (h *MarketplaceHandler) listCatalogPresets(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}
	SendJSON(ctx, map[string]any{"presets": marketplace.CatalogPresets()})
}

func (h *MarketplaceHandler) previewCatalog(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	rawURL := strings.TrimSpace(string(ctx.QueryArgs().Peek("url")))
	if rawURL == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "url is required")
		return
	}

	catalog, err := marketplace.FetchRemoteCatalog(rawURL)
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}

	SendJSON(ctx, map[string]any{
		"catalog": map[string]any{
			"name":         catalog.Name,
			"description":  catalog.Description,
			"manifest_url": catalog.ManifestURL,
			"owner_name":   catalog.OwnerName,
			"plugins":      catalog.Plugins,
			"plugin_count": len(catalog.Plugins),
		},
	})
}
