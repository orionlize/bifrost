package handlers

import (
	"strings"
	"testing"

	"github.com/valyala/fasthttp"
)

func TestBasePathMiddleware_StripsPrefix(t *testing.T) {
	t.Parallel()

	var seenPath string
	handler := BasePathMiddleware("/bifrost")(func(ctx *fasthttp.RequestCtx) {
		seenPath = string(ctx.Path())
		ctx.SetStatusCode(fasthttp.StatusOK)
	})

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI("http://localhost/bifrost/api/session")
	handler(ctx)

	if seenPath != "/api/session" {
		t.Fatalf("expected stripped path /api/session, got %q", seenPath)
	}
}

func TestBasePathMiddleware_PassthroughWithoutPrefix(t *testing.T) {
	t.Parallel()

	var seenPath string
	handler := BasePathMiddleware("/bifrost")(func(ctx *fasthttp.RequestCtx) {
		seenPath = string(ctx.Path())
		ctx.SetStatusCode(fasthttp.StatusOK)
	})

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI("http://localhost/health")
	handler(ctx)

	if seenPath != "/health" {
		t.Fatalf("expected passthrough path /health, got %q", seenPath)
	}
}

func TestBasePathMiddleware_RedirectsBarePrefix(t *testing.T) {
	t.Parallel()

	handler := BasePathMiddleware("/bifrost")(func(ctx *fasthttp.RequestCtx) {
		t.Fatal("next handler should not run for bare prefix redirect")
	})

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI("http://localhost/bifrost")
	handler(ctx)

	if ctx.Response.StatusCode() != fasthttp.StatusMovedPermanently {
		t.Fatalf("expected 301 redirect, got %d", ctx.Response.StatusCode())
	}
	location := string(ctx.Response.Header.Peek("Location"))
	if !strings.HasSuffix(location, "/bifrost/") {
		t.Fatalf("expected redirect ending with /bifrost/, got %q", location)
	}
}

func TestBasePathMiddleware_NoOpForEmptyPrefix(t *testing.T) {
	t.Parallel()

	var seenPath string
	handler := BasePathMiddleware("")(func(ctx *fasthttp.RequestCtx) {
		seenPath = string(ctx.Path())
		ctx.SetStatusCode(fasthttp.StatusOK)
	})

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI("http://localhost/workspace")
	handler(ctx)

	if seenPath != "/workspace" {
		t.Fatalf("expected unchanged path /workspace, got %q", seenPath)
	}
}
