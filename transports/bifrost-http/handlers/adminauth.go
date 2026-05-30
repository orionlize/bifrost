package handlers

import (
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
