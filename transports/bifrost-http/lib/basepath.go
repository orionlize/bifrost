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
