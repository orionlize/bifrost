package handlers

import (
	"testing"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/bifrost-http/integrations"
	"github.com/valyala/fasthttp"
)

func TestResponsesCompactRoutePathsAreRegistered(t *testing.T) {
	paths := append(
		[]string{"/v1/responses/compact"},
		integrations.OpenAIResponsesCompactPaths("/openai")...,
	)

	r := router.New()
	for _, path := range paths {
		recorded := path
		r.POST(path, func(ctx *fasthttp.RequestCtx) {
			ctx.SetStatusCode(fasthttp.StatusTeapot)
			ctx.SetUserValue("registered_path", recorded)
		})
	}

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			ctx := &fasthttp.RequestCtx{}
			ctx.Request.Header.SetMethod(fasthttp.MethodPost)
			ctx.Request.SetRequestURI(path)

			r.Handler(ctx)

			if ctx.Response.StatusCode() == fasthttp.StatusMethodNotAllowed {
				t.Fatalf("expected route %s to be registered, got 405 Method Not Allowed", path)
			}
			if ctx.Response.StatusCode() != fasthttp.StatusTeapot {
				t.Fatalf("status = %d, want %d", ctx.Response.StatusCode(), fasthttp.StatusTeapot)
			}
		})
	}
}

func TestOpenAIResponsesCompactPaths(t *testing.T) {
	paths := integrations.OpenAIResponsesCompactPaths("/openai")
	want := []string{
		"/openai/v1/responses/compact",
		"/openai/responses/compact",
		"/openai/openai/responses/compact",
	}
	if len(paths) != len(want) {
		t.Fatalf("len(paths) = %d, want %d", len(paths), len(want))
	}
	for i, path := range paths {
		if path != want[i] {
			t.Fatalf("paths[%d] = %q, want %q", i, path, want[i])
		}
	}
}

func TestParseResponsesCompactBody(t *testing.T) {
	model, stream := parseResponsesCompactBody([]byte(`{"model":"gpt-5.5","input":[],"stream":true}`))
	if model != "gpt-5.5" {
		t.Fatalf("model = %q, want gpt-5.5", model)
	}
	if !stream {
		t.Fatal("expected stream=true")
	}
}

func TestIsResponsesCompactStreamingAcceptHeader(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("Accept", "text/event-stream")
	if !isResponsesCompactStreaming(ctx, false) {
		t.Fatal("expected Accept: text/event-stream to enable streaming")
	}
}

func TestResponsesCompactRequestTypeMiddleware(t *testing.T) {
	var seen schemas.RequestType
	handler := responsesCompactRequestTypeMiddleware(func(ctx *fasthttp.RequestCtx) {
		if v, ok := ctx.UserValue(schemas.BifrostContextKeyHTTPRequestType).(schemas.RequestType); ok {
			seen = v
		}
	})

	ctx := &fasthttp.RequestCtx{}
	handler(ctx)

	if seen != schemas.PassthroughRequest {
		t.Fatalf("request type = %q, want %q", seen, schemas.PassthroughRequest)
	}
}
