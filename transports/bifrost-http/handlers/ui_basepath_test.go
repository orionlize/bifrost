package handlers

import (
	"strings"
	"testing"
)

func TestInjectRuntimeBasePath(t *testing.T) {
	html := []byte(`<!doctype html><html><head></head><body><script src="/assets/app.js"></script></body></html>`)
	got := string(injectRuntimeBasePath(html, "/zai"))
	if !strings.Contains(got, `window.__BIFROST_BASE_PATH__="/zai"`) {
		t.Fatalf("missing runtime base path script: %s", got)
	}
	if !strings.Contains(got, `src="/zai/assets/app.js"`) {
		t.Fatalf("missing rewritten asset path: %s", got)
	}
}

func TestInjectRuntimeBasePathSkipsDoublePrefix(t *testing.T) {
	html := []byte(`<!doctype html><html><head></head><body><script src="/zai/assets/app.js"></script></body></html>`)
	got := string(injectRuntimeBasePath(html, "/zai"))
	if strings.Contains(got, `src="/zai/zai/assets`) {
		t.Fatalf("double-prefixed assets: %s", got)
	}
}
