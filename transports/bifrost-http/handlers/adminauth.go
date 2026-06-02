package handlers

import (
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/valyala/fasthttp"
)

func requireLocalAdmin(ctx *fasthttp.RequestCtx, store configstore.ConfigStore) bool {
	if store == nil {
		return false
	}
	authConfig, err := store.GetAuthConfig(ctx)
	if err != nil {
		return false
	}
	if authConfig == nil || !authConfig.IsEnabled {
		return true
	}
	isLocalAdmin, ok := ctx.UserValue(schemas.IsLocalAdminContextKey).(bool)
	return ok && isLocalAdmin
}

// requireDashboardSession allows local admins and any authenticated dashboard session.
// Used for read-only settings needed outside the API Keys admin page (e.g. routing CEL builder).
func requireDashboardSession(ctx *fasthttp.RequestCtx, store configstore.ConfigStore) bool {
	if requireLocalAdmin(ctx, store) {
		return true
	}
	if store == nil {
		return false
	}
	authConfig, err := store.GetAuthConfig(ctx)
	if err != nil {
		return false
	}
	if authConfig == nil || !authConfig.IsEnabled {
		return true
	}
	if token, ok := ctx.UserValue(schemas.BifrostContextKeySessionToken).(string); ok && strings.TrimSpace(token) != "" {
		return true
	}
	return false
}
