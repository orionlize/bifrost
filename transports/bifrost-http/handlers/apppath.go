package handlers

import (
	"net/url"
	"strings"

	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

const aoneOAuthCallbackPathSuffix = "/api/aone/oauth/callback"

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

func defaultAppReturnTo(basePath string) string {
	return ensureSubpathRedirect(basePath, defaultAoneOAuthReturnTo)
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
	ctx.Redirect(ensureSubpathRedirect(h.effectiveBasePath(ctx, ""), target), fasthttp.StatusFound)
}

// effectiveBasePath prefers the server-configured BIFROST_BASE_PATH, then infers from
// proxy headers, the OAuth callback URL, or the Referer (for example /zai/login → /zai).
func (h *AoneOAuthHandler) effectiveBasePath(ctx *fasthttp.RequestCtx, oauthCallbackURI string) string {
	if h.basePath != "" {
		return h.basePath
	}
	return resolveEffectiveBasePath("", ctx, oauthCallbackURI)
}

func resolveEffectiveBasePath(configured string, ctx *fasthttp.RequestCtx, oauthCallbackURI string) string {
	if bp := lib.NormalizeBasePath(configured); bp != "" {
		return bp
	}
	if bp := basePathFromForwardedHeaders(ctx); bp != "" {
		return bp
	}
	if bp := basePathFromOAuthCallbackURI(oauthCallbackURI); bp != "" {
		return bp
	}
	if bp := basePathFromReferer(ctx); bp != "" {
		return bp
	}
	return ""
}

func basePathFromForwardedHeaders(ctx *fasthttp.RequestCtx) string {
	if ctx == nil {
		return ""
	}
	raw := strings.TrimSpace(string(ctx.Request.Header.Peek("X-Forwarded-Prefix")))
	if raw == "" {
		return ""
	}
	if idx := strings.Index(raw, ","); idx >= 0 {
		raw = strings.TrimSpace(raw[:idx])
	}
	return lib.NormalizeBasePath(raw)
}

func basePathFromOAuthCallbackURI(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Path == "" {
		return ""
	}
	for _, suffix := range []string{aoneOAuthCallbackPathSuffix, zwitchOAuthCallbackPath} {
		if strings.HasSuffix(parsed.Path, suffix) {
			return lib.NormalizeBasePath(strings.TrimSuffix(parsed.Path, suffix))
		}
	}
	return ""
}

func basePathFromReferer(ctx *fasthttp.RequestCtx) string {
	if ctx == nil {
		return ""
	}
	referer := strings.TrimSpace(string(ctx.Request.Header.Peek("Referer")))
	if referer == "" {
		return ""
	}
	parsed, err := url.Parse(referer)
	if err != nil || parsed.Path == "" || parsed.Path == "/" {
		return ""
	}
	for _, marker := range []string{"/login", aoneOAuthCallbackPathSuffix, defaultAoneOAuthReturnTo} {
		if idx := strings.Index(parsed.Path, marker); idx > 0 {
			return lib.NormalizeBasePath(parsed.Path[:idx])
		}
	}
	return ""
}
