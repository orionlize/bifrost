package handlers

import (
	"net/url"
	"strings"

	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

func stripAppRoutePrefix(basePath, route string) string {
	route = strings.TrimSpace(route)
	if route == "" {
		return route
	}
	pathPart := route
	suffix := ""
	if idx := strings.IndexAny(route, "?#"); idx >= 0 {
		pathPart = route[:idx]
		suffix = route[idx:]
	}
	return lib.StripBasePath(basePath, pathPart) + suffix
}

func ensureSubpathRedirect(basePath, target string) string {
	basePath = lib.NormalizeBasePath(basePath)
	target = strings.TrimSpace(target)
	if target == "" {
		target = defaultAoneOAuthReturnTo
	}
	if basePath == "" {
		return target
	}
	if strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "https://") {
		u, err := url.Parse(target)
		if err != nil {
			return target
		}
		u.Path = lib.WithBasePath(basePath, lib.StripBasePath(basePath, u.Path))
		return u.String()
	}
	return lib.WithBasePath(basePath, stripAppRoutePrefix(basePath, target))
}

func applySubpathToURLPath(u *url.URL, basePath string) {
	if u == nil {
		return
	}
	u.Path = lib.WithBasePath(basePath, lib.StripBasePath(basePath, u.Path))
}

func (h *AoneOAuthHandler) redirectTo(ctx *fasthttp.RequestCtx, target string) {
	ctx.Redirect(ensureSubpathRedirect(h.basePath, target), fasthttp.StatusFound)
}
