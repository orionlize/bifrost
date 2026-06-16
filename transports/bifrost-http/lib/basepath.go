package lib

import "strings"

// NormalizeBasePath canonicalizes an HTTP path prefix for subpath deployments.
// Empty string and "/" both mean the app is served from the site root.
func NormalizeBasePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" || path == "/" {
		return ""
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return strings.TrimSuffix(path, "/")
}

// StripBasePath removes a configured base path prefix from a pathname.
func StripBasePath(basePath, pathname string) string {
	basePath = NormalizeBasePath(basePath)
	pathname = strings.TrimSpace(pathname)
	if basePath == "" || pathname == "" {
		return pathname
	}
	if pathname == basePath {
		return "/"
	}
	if strings.HasPrefix(pathname, basePath+"/") {
		stripped := strings.TrimPrefix(pathname, basePath)
		if stripped == "" {
			return "/"
		}
		return stripped
	}
	return pathname
}

// WithBasePath joins a base path with a root-relative endpoint.
// Query strings and fragments on endpoint are preserved.
func WithBasePath(basePath, endpoint string) string {
	basePath = NormalizeBasePath(basePath)
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = "/"
	}
	if !strings.HasPrefix(endpoint, "/") {
		endpoint = "/" + endpoint
	}
	if basePath == "" {
		return endpoint
	}

	pathPart := endpoint
	suffix := ""
	if idx := strings.IndexAny(endpoint, "?#"); idx >= 0 {
		pathPart = endpoint[:idx]
		suffix = endpoint[idx:]
	}
	if pathPart == basePath || strings.HasPrefix(pathPart, basePath+"/") {
		return endpoint
	}
	return basePath + pathPart + suffix
}

// SessionCookiePath returns the HTTP cookie Path for dashboard session cookies.
// Subpath deployments scope cookies to the app prefix so they do not leak to the site root.
func SessionCookiePath(basePath string) string {
	basePath = NormalizeBasePath(basePath)
	if basePath == "" {
		return "/"
	}
	return basePath
}
