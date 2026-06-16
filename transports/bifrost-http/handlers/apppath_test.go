package handlers

import (
	"testing"

	"github.com/valyala/fasthttp"
)

func TestBasePathFromReferer_AdminLogin(t *testing.T) {
	tests := []struct {
		name     string
		referer  string
		wantPath string
	}{
		{name: "root admin login", referer: "http://localhost:8080/admin-login", wantPath: ""},
		{name: "subpath admin login", referer: "http://localhost:8080/zai/admin-login", wantPath: "/zai"},
		{name: "root user login", referer: "http://localhost:8080/login", wantPath: ""},
		{name: "subpath user login", referer: "http://localhost:8080/zai/login", wantPath: "/zai"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := &fasthttp.RequestCtx{}
			ctx.Request.Header.Set("Referer", tt.referer)
			got := basePathFromReferer(ctx)
			if got != tt.wantPath {
				t.Fatalf("got %q, want %q", got, tt.wantPath)
			}
		})
	}
}
