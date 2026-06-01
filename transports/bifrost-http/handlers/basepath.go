package handlers

import (
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

// BasePathMiddleware strips a configured URL prefix before routing so Bifrost can
// be served under a subpath (for example /bifrost) without duplicating every route.
// Requests that do not include the prefix are passed through unchanged so /health
// and /v1/* remain reachable for probes and direct API clients.
func BasePathMiddleware(basePath string) schemas.BifrostHTTPMiddleware {
	basePath = lib.NormalizeBasePath(basePath)
	if basePath == "" {
		return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
			return next
		}
	}

	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			path := string(ctx.Path())
			if path == basePath {
				ctx.Redirect(basePath+"/", fasthttp.StatusMovedPermanently)
				return
			}
			if strings.HasPrefix(path, basePath+"/") {
				stripped := strings.TrimPrefix(path, basePath)
				if stripped == "" {
					stripped = "/"
				}
				ctx.Request.URI().SetPath(stripped)
			}
			next(ctx)
		}
	}
}
