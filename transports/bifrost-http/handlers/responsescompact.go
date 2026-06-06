package handlers

import (
	"context"
	"fmt"
	"strings"

	"github.com/bytedance/sonic"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

const responsesCompactUpstreamPath = "/v1/responses/compact"

func responsesCompactRequestTypeMiddleware(next fasthttp.RequestHandler) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		ctx.SetUserValue(schemas.BifrostContextKeyHTTPRequestType, schemas.PassthroughRequest)
		next(ctx)
	}
}

func responsesCompactMiddlewares(middlewares ...schemas.BifrostHTTPMiddleware) []schemas.BifrostHTTPMiddleware {
	return append([]schemas.BifrostHTTPMiddleware{responsesCompactRequestTypeMiddleware}, middlewares...)
}

// ResponsesCompactHandler forwards POST /responses/compact requests to the upstream OpenAI endpoint.
func ResponsesCompactHandler(client *bifrost.Bifrost, store lib.HandlerStore) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		body := append([]byte(nil), ctx.PostBody()...)
		if len(body) == 0 {
			SendError(ctx, fasthttp.StatusBadRequest, "request body is required")
			return
		}

		model, isStream := parseResponsesCompactBody(body)
		if model == "" {
			SendError(ctx, fasthttp.StatusBadRequest, "model is required")
			return
		}

		provider, err := resolveResponsesCompactProvider(ctx, store, model)
		if err != nil {
			SendError(ctx, fasthttp.StatusBadRequest, err.Error())
			return
		}

		bifrostCtx, cancel := lib.ConvertToBifrostContext(ctx, store)
		if bifrostCtx == nil {
			SendError(ctx, fasthttp.StatusBadRequest, "failed to convert context")
			return
		}

		passthroughReq := &schemas.BifrostPassthroughRequest{
			Method:      fasthttp.MethodPost,
			Path:        responsesCompactUpstreamPath,
			Body:        body,
			SafeHeaders: collectPassthroughSafeHeaders(ctx),
			Provider:    provider,
			Model:       model,
		}

		if isResponsesCompactStreaming(ctx, isStream) {
			handleResponsesCompactStream(ctx, client, bifrostCtx, cancel, provider, passthroughReq)
			return
		}

		defer cancel()

		resp, bifrostErr := client.Passthrough(bifrostCtx, provider, passthroughReq)
		if bifrostErr != nil {
			forwardProviderHeadersFromContext(ctx, bifrostCtx)
			SendBifrostError(ctx, bifrostErr)
			return
		}

		forwardProviderHeaders(ctx, resp.ExtraFields.ProviderResponseHeaders)
		ctx.SetStatusCode(resp.StatusCode)
		for key, value := range resp.Headers {
			if shouldSkipPassthroughResponseHeader(key) {
				continue
			}
			ctx.Response.Header.Set(key, value)
		}
		ctx.Response.SetBody(resp.Body)
	}
}

func handleResponsesCompactStream(
	ctx *fasthttp.RequestCtx,
	client *bifrost.Bifrost,
	bifrostCtx *schemas.BifrostContext,
	cancel context.CancelFunc,
	provider schemas.ModelProvider,
	req *schemas.BifrostPassthroughRequest,
) {
	traceCompleter, _ := ctx.UserValue(schemas.BifrostContextKeyTraceCompleter).(func([]schemas.PluginLogEntry))

	stream, bifrostErr := client.PassthroughStream(bifrostCtx, provider, req)
	if bifrostErr != nil {
		cancel()
		forwardProviderHeadersFromContext(ctx, bifrostCtx)
		SendBifrostError(ctx, bifrostErr)
		return
	}

	firstChunk, ok := <-stream
	if !ok {
		cancel()
		SendError(ctx, fasthttp.StatusBadGateway, "passthrough stream ended before headers were received")
		return
	}
	if firstChunk == nil {
		cancel()
		SendError(ctx, fasthttp.StatusBadGateway, "passthrough stream returned nil first chunk")
		return
	}
	if firstChunk.BifrostError != nil {
		cancel()
		forwardProviderHeadersFromContext(ctx, bifrostCtx)
		SendBifrostError(ctx, firstChunk.BifrostError)
		return
	}

	passthroughResp := firstChunk.BifrostPassthroughResponse
	if passthroughResp == nil {
		cancel()
		SendError(ctx, fasthttp.StatusBadGateway, "passthrough stream returned empty first chunk")
		return
	}

	ctx.SetUserValue(schemas.BifrostContextKeyDeferTraceCompletion, true)

	ctx.SetStatusCode(passthroughResp.StatusCode)
	ctx.SetContentType("text/event-stream")
	ctx.Response.Header.Set("Cache-Control", "no-cache")
	ctx.Response.Header.Set("Connection", "keep-alive")
	ctx.Response.Header.Set("X-Accel-Buffering", "no")
	for key, value := range passthroughResp.Headers {
		if shouldSkipPassthroughStreamResponseHeader(key) {
			continue
		}
		ctx.Response.Header.Set(key, value)
	}

	reader := lib.NewSSEStreamReader()
	ctx.Response.SetBodyStream(reader, -1)

	go func() {
		defer func() {
			if traceCompleter != nil {
				traceCompleter(nil)
			}
			reader.Done()
			cancel()
		}()

		if len(passthroughResp.Body) > 0 {
			if !reader.Send(passthroughResp.Body) {
				return
			}
		}

		for chunk := range stream {
			if chunk == nil {
				continue
			}
			if chunk.BifrostError != nil {
				break
			}
			if chunk.BifrostPassthroughResponse != nil && len(chunk.BifrostPassthroughResponse.Body) > 0 {
				if !reader.Send(chunk.BifrostPassthroughResponse.Body) {
					return
				}
			}
		}
	}()
}

func resolveResponsesCompactProvider(ctx *fasthttp.RequestCtx, store lib.HandlerStore, model string) (schemas.ModelProvider, error) {
	provider, modelName := schemas.ParseModelString(model, "")
	if modelName == "" {
		return "", fmt.Errorf("model is required")
	}
	if provider == "" {
		providers := store.GetProvidersForModel(modelName)
		if len(providers) == 0 {
			provider = schemas.OpenAI
		} else {
			ctx.SetUserValue(lib.FastHTTPUserValueModelCatalogResolution, &lib.ModelCatalogResolution{
				Model:            modelName,
				ResolvedProvider: providers[0],
				AllProviders:     providers,
			})
			provider = providers[0]
		}
	}

	providerHeader := string(ctx.Request.Header.Peek("x-model-provider"))
	if providerHeader != "" {
		provider = schemas.ModelProvider(providerHeader)
	}
	return provider, nil
}

func parseResponsesCompactBody(body []byte) (model string, isStream bool) {
	var parsed struct {
		Model  string `json:"model"`
		Stream bool   `json:"stream"`
	}
	if err := sonic.Unmarshal(body, &parsed); err == nil {
		model = strings.TrimSpace(parsed.Model)
		isStream = parsed.Stream
	}
	return model, isStream
}

func isResponsesCompactStreaming(ctx *fasthttp.RequestCtx, bodyStream bool) bool {
	if bodyStream {
		return true
	}
	accept := strings.ToLower(string(ctx.Request.Header.Peek("Accept")))
	return strings.Contains(accept, "text/event-stream")
}

func collectPassthroughSafeHeaders(ctx *fasthttp.RequestCtx) map[string]string {
	safeHeaders := make(map[string]string)
	ctx.Request.Header.All()(func(key, value []byte) bool {
		keyStr := strings.ToLower(string(key))
		switch keyStr {
		case "authorization", "api-key", "x-api-key", "x-goog-api-key",
			"host", "connection", "transfer-encoding", "cookie", "set-cookie", "proxy-authorization", "accept-encoding":
		default:
			if strings.HasPrefix(keyStr, "x-bf-") {
				return true
			}
			safeHeaders[keyStr] = string(value)
		}
		return true
	})
	return safeHeaders
}

func shouldSkipPassthroughResponseHeader(key string) bool {
	switch strings.ToLower(key) {
	case "connection", "transfer-encoding", "set-cookie", "proxy-authenticate", "www-authenticate":
		return true
	default:
		return false
	}
}

func shouldSkipPassthroughStreamResponseHeader(key string) bool {
	switch strings.ToLower(key) {
	case "connection", "transfer-encoding", "content-length", "content-type",
		"cache-control", "x-accel-buffering",
		"set-cookie", "proxy-authenticate", "www-authenticate":
		return true
	default:
		return false
	}
}
