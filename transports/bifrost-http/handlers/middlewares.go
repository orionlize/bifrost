package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	providerUtils "github.com/maximhq/bifrost/core/providers/utils"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/aoneoauth"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/framework/temptoken"
	"github.com/maximhq/bifrost/framework/tracing"
	"github.com/maximhq/bifrost/transports/bifrost-http/integrations"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"golang.org/x/sync/singleflight"
)

var reloadedAoneVirtualKeys sync.Map

var loggingSkipPaths = []string{"/health", "/_next", "/api/dev"}
var realtimeTransportPaths = buildRealtimeTransportPathSet()

const forwardRequestLogErrorBodyMaxBytes = 8 * 1024

// InferenceForwardMarkerMiddleware marks the request as an inference/forwarding route so
// ForwardRequestLogMiddleware emits an access log. Management/UI routes omit this marker.
func InferenceForwardMarkerMiddleware() schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			ctx.SetUserValue(lib.FastHTTPUserValueInferenceForward, true)
			next(ctx)
		}
	}
}

// ForwardRequestLogMiddleware logs one structured HTTP access line per request after
// the handler returns, using the same logger.LogHTTPRequest path as other transport logs.
func ForwardRequestLogMiddleware() schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			start := time.Now()
			defer func() {
				writeForwardRequestLog(ctx, start)
			}()
			next(ctx)
		}
	}
}

func writeForwardRequestLog(ctx *fasthttp.RequestCtx, start time.Time) {
	if logger == nil {
		return
	}
	if marked, ok := ctx.UserValue(lib.FastHTTPUserValueInferenceForward).(bool); !ok || !marked {
		return
	}

	statusCode := ctx.Response.StatusCode()
	level := schemas.LogLevelInfo
	if statusCode >= fasthttp.StatusInternalServerError {
		level = schemas.LogLevelError
	} else if statusCode >= fasthttp.StatusBadRequest {
		level = schemas.LogLevelWarn
	}

	logBuilder := logger.LogHTTPRequest(level, "request completed").
		Str("http.method", string(ctx.Method())).
		Str("http.target", string(ctx.RequestURI())).
		Int("http.status_code", statusCode).
		Int64("http.request_duration_ms", time.Since(start).Milliseconds()).
		Str("http.remote_addr", ctx.RemoteAddr().String()).
		Str("http.user_agent", string(ctx.Request.Header.UserAgent()))

	if traceID, ok := ctx.UserValue(schemas.BifrostContextKeyTraceID).(string); ok && traceID != "" {
		logBuilder = logBuilder.Str("trace_id", traceID)
	}
	if errMsg := extractForwardResponseError(statusCode, ctx.Response.Body()); errMsg != "" {
		logBuilder = logBuilder.Str("error.message", errMsg)
	}
	logBuilder.Send()
}

func extractForwardResponseError(statusCode int, body []byte) string {
	if statusCode < fasthttp.StatusBadRequest || len(body) == 0 {
		return ""
	}
	if len(body) > forwardRequestLogErrorBodyMaxBytes {
		body = body[:forwardRequestLogErrorBodyMaxBytes]
	}

	var bifrostErr schemas.BifrostError
	if err := json.Unmarshal(body, &bifrostErr); err == nil {
		if msg := forwardErrorMessageFromBifrostError(&bifrostErr); msg != "" {
			return msg
		}
	}

	var openAIStyle struct {
		Error *schemas.ErrorField `json:"error"`
	}
	if err := json.Unmarshal(body, &openAIStyle); err == nil && openAIStyle.Error != nil {
		if msg := strings.TrimSpace(openAIStyle.Error.Message); msg != "" {
			return msg
		}
	}

	var simple struct {
		Message string `json:"message"`
		Error   string `json:"error"`
	}
	if err := json.Unmarshal(body, &simple); err == nil {
		if msg := strings.TrimSpace(simple.Message); msg != "" {
			return msg
		}
		if msg := strings.TrimSpace(simple.Error); msg != "" {
			return msg
		}
	}

	fallback := strings.TrimSpace(string(body))
	if fallback == "" {
		return fmt.Sprintf("HTTP %d", statusCode)
	}
	const maxFallbackLen = 512
	if len(fallback) > maxFallbackLen {
		return fallback[:maxFallbackLen] + "..."
	}
	return fallback
}

func forwardErrorMessageFromBifrostError(bifrostErr *schemas.BifrostError) string {
	if bifrostErr == nil {
		return ""
	}
	if bifrostErr.Error != nil {
		if msg := strings.TrimSpace(bifrostErr.Error.Message); msg != "" {
			return msg
		}
	}
	return strings.TrimSpace(bifrostErr.GetErrorString())
}

// SecurityHeadersMiddleware sets security-related HTTP headers on every response.
// This should wrap the outermost handler so all responses (API, UI, errors) include these headers.
func SecurityHeadersMiddleware() schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			ctx.Response.Header.Set("X-Frame-Options", "DENY")
			ctx.Response.Header.Set("X-Content-Type-Options", "nosniff")
			ctx.Response.Header.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			ctx.Response.Header.Set("Content-Security-Policy", "frame-ancestors 'none'")
			ctx.Response.Header.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
			// Only set HSTS when serving over HTTPS (detected via reverse proxy header or direct TLS)
			if string(ctx.Request.Header.Peek("X-Forwarded-Proto")) == "https" || ctx.IsTLS() {
				ctx.Response.Header.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			next(ctx)
		}
	}
}

// CorsMiddleware handles CORS headers for localhost and configured allowed origins
func CorsMiddleware(config *lib.Config) schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			// startTime := time.Now()
			// skip logging if it's a /health check request
			if slices.IndexFunc(loggingSkipPaths, func(path string) bool {
				return strings.HasPrefix(string(ctx.RequestURI()), path)
			}) != -1 {
				goto corsFlow
			}
			// defer func() {
			// 	statusCode := ctx.Response.Header.StatusCode()
			// 	level := schemas.LogLevelInfo
			// 	if statusCode >= 500 {
			// 		level = schemas.LogLevelError
			// 	} else if statusCode >= 400 {
			// 		level = schemas.LogLevelWarn
			// 	}
			// 	logBuilder := logger.LogHTTPRequest(level, "request completed").
			// 		Str("http.method", string(ctx.Method())).
			// 		Str("http.target", string(ctx.RequestURI())).
			// 		Int("http.status_code", statusCode).
			// 		Int64("http.request_duration_ms", time.Since(startTime).Milliseconds()).
			// 		Str("http.remote_addr", ctx.RemoteAddr().String()).
			// 		Str("http.user_agent", string(ctx.Request.Header.UserAgent()))
			// 	if traceID, ok := ctx.UserValue(schemas.BifrostContextKeyTraceID).(string); ok && traceID != "" {
			// 		logBuilder = logBuilder.Str("trace_id", traceID)
			// 	}
			// 	logBuilder.Send()
			// }()
		corsFlow:
			origin := string(ctx.Request.Header.Peek("Origin"))
			allowed := IsOriginAllowed(origin, config.ClientConfig.AllowedOrigins)
			// Credentialed responses are sent when the origin is not matched solely by a
			// wildcard AllowedOrigins — i.e. the origin is localhost or explicitly listed.
			credentialed := !slices.Contains(config.ClientConfig.AllowedOrigins, "*") ||
				isLocalhostOrigin(origin) ||
				slices.Contains(config.ClientConfig.AllowedOrigins, origin)

			allowedHeaders := []string{"Content-Type", "Authorization", "X-Requested-With", "X-Stainless-Timeout", "X-Api-Key", "X-OpenAI-Agents-SDK", "X-Operation-ID", "X-Device-Fingerprint"}
			if slices.Contains(config.ClientConfig.AllowedHeaders, "*") {
				if credentialed {
					// Per the Fetch spec, Access-Control-Allow-Headers: * is NOT treated as a
					// wildcard when Access-Control-Allow-Credentials: true is set — browsers
					// interpret it as a literal header name. For credentialed preflight requests,
					// reflect back the requested headers instead.
					if requestedHeaders := string(ctx.Request.Header.Peek("Access-Control-Request-Headers")); requestedHeaders != "" {
						allowedHeaders = []string{requestedHeaders}
					}
					// For non-preflight requests (no Access-Control-Request-Headers), keep defaults.
				} else {
					allowedHeaders = []string{"*"}
				}
			} else if len(config.ClientConfig.AllowedHeaders) > 0 {
				// append allowed headers from config to the default headers
				for _, header := range config.ClientConfig.AllowedHeaders {
					if !slices.Contains(allowedHeaders, header) {
						allowedHeaders = append(allowedHeaders, header)
					}
				}
			}
			// Check if origin is allowed (localhost always allowed + configured origins)
			if allowed {
				ctx.Response.Header.Set("Access-Control-Allow-Origin", origin)
				ctx.Response.Header.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD")
				ctx.Response.Header.Set("Access-Control-Allow-Headers", strings.Join(allowedHeaders, ", "))
				if credentialed {
					ctx.Response.Header.Set("Access-Control-Allow-Credentials", "true")
				}
				ctx.Response.Header.Set("Access-Control-Max-Age", "86400")
				// Vary: Origin tells caches that the response varies based on the Origin
				// request header, preventing incorrect CORS headers from being served.
				ctx.Response.Header.Set("Vary", "Origin")
			}
			// Handle preflight OPTIONS requests
			if string(ctx.Method()) == "OPTIONS" {
				if allowed {
					ctx.SetStatusCode(fasthttp.StatusOK)
				} else {
					ctx.SetStatusCode(fasthttp.StatusForbidden)
				}
				return
			}
			next(ctx)
		}
	}
}

// RequestDecompressionMiddleware transparently decompresses compressed request bodies.
// Two paths based on compressed Content-Length:
//   - Large or chunked (CL > threshold or CL unknown): streaming decompression via
//     SetBodyStream, avoiding full body materialization. Uses pooled gzip readers
//     matching the response-side pattern in core/providers/utils.
//   - Small (CL ≤ threshold): buffered decompression via io.ReadAll + SetBodyRaw,
//     with decompression bomb protection via MaxRequestBodySizeMB.
func RequestDecompressionMiddleware(config *lib.Config) schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			if len(ctx.Request.Header.ContentEncoding()) == 0 {
				next(ctx)
				return
			}

			if shouldStreamDecompress(config, ctx) {
				cleanup, applied, err := streamingDecompress(ctx)
				if err != nil {
					SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("invalid compressed request body: %v", err))
					return
				}
				if applied {
					next(ctx)
					cleanup()
					return
				}
				// No body stream available (StreamRequestBody not enabled) — fall
				// through to the buffered decompression path below.
			}

			// Buffered path: small compressed request — materialize fully.
			maxRequestBodyBytes := 100 * 1024 * 1024 // default 100 MB (matches decodeRequestBodyWithLimit fallback)
			if config != nil && config.ClientConfig.MaxRequestBodySizeMB > 0 {
				maxRequestBodyBytes = config.ClientConfig.MaxRequestBodySizeMB * 1024 * 1024
			}

			body, err := decodeRequestBodyWithLimit(&ctx.Request, maxRequestBodyBytes)
			if errors.Is(err, errRequestBodyTooLarge) {
				SendError(ctx, fasthttp.StatusRequestEntityTooLarge, fmt.Sprintf("decompressed request body exceeds max allowed size of %d bytes", maxRequestBodyBytes))
				return
			}
			if err != nil {
				SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("invalid compressed request body: %v", err))
				return
			}

			ctx.Request.SetBodyRaw(body)
			ctx.Request.Header.Del(fasthttp.HeaderContentEncoding)
			ctx.Request.Header.Del(fasthttp.HeaderContentLength)
			next(ctx)
		}
	}
}

// shouldStreamDecompress returns true when the compressed request body should
// use streaming decompression rather than full materialization. Uses the
// config threshold (set by enterprise from LargePayloadConfig.RequestThresholdBytes)
// or falls back to DefaultLargePayloadRequestThresholdBytes.
// Chunked requests (unknown size) always stream to be safe.
func shouldStreamDecompress(config *lib.Config, ctx *fasthttp.RequestCtx) bool {
	contentLength := ctx.Request.Header.ContentLength()
	// Chunked transfer encoding: fasthttp reports -1. Size unknown, stream to be safe.
	if contentLength < 0 {
		return true
	}
	var threshold int64 = schemas.DefaultLargePayloadRequestThresholdBytes
	if config != nil && config.StreamingDecompressThreshold > 0 {
		threshold = config.StreamingDecompressThreshold
	}
	return int64(contentLength) > threshold
}

// streamingDecompress wraps the request body stream with a streaming decompression
// reader, avoiding full body materialization for large compressed requests.
// Returns (cleanup, applied, err):
//   - applied=true: body stream was wrapped; caller must invoke cleanup after the
//     handler chain completes and the body is fully consumed.
//   - applied=false: no body stream available (StreamRequestBody not enabled on the
//     server). Caller should fall back to the buffered decompression path.
func streamingDecompress(ctx *fasthttp.RequestCtx) (cleanup func(), applied bool, err error) {
	bodyStream := ctx.RequestBodyStream()
	if bodyStream == nil {
		return func() {}, false, nil
	}

	encoding := strings.ToLower(strings.TrimSpace(
		string(ctx.Request.Header.ContentEncoding()),
	))

	decompReader, cleanup, err := newDecompressReader(bodyStream, encoding)
	if err != nil {
		return nil, false, err
	}

	ctx.Request.SetBodyStream(decompReader, -1)
	ctx.Request.Header.Del(fasthttp.HeaderContentEncoding)
	ctx.Request.Header.Del(fasthttp.HeaderContentLength)

	return cleanup, true, nil
}

var errRequestBodyTooLarge = errors.New("decompressed request body exceeds max allowed size")

// decodeRequestBodyWithLimit decodes the request body with a limit on the size of the body.
func decodeRequestBodyWithLimit(req *fasthttp.Request, maxRequestBodyBytes int) ([]byte, error) {
	encoding := strings.ToLower(strings.TrimSpace(string(req.Header.ContentEncoding())))
	bodyReader := bytes.NewReader(req.Body())

	var reader io.Reader = bodyReader
	cleanup := func() {}
	if encoding != "" {
		var err error
		reader, cleanup, err = newDecompressReader(bodyReader, encoding)
		if err != nil {
			return nil, err
		}
	}
	defer cleanup()

	if maxRequestBodyBytes <= 0 {
		maxRequestBodyBytes = 100 * 1024 * 1024 // 100 MB hard cap
	}

	limitedReader := &io.LimitedReader{R: reader, N: int64(maxRequestBodyBytes + 1)}
	body, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, err
	}
	if len(body) > maxRequestBodyBytes {
		return nil, errRequestBodyTooLarge
	}
	return body, nil
}

// newDecompressReader wraps r with a decompression reader for the given encoding.
// All encodings use pooled readers from core/providers/utils. The returned cleanup
// function must be called when the reader is no longer needed.
func newDecompressReader(r io.Reader, encoding string) (io.Reader, func(), error) {
	switch encoding {
	case "gzip":
		gz, err := providerUtils.AcquireGzipReader(r)
		if err != nil {
			return nil, nil, err
		}
		return gz, func() { providerUtils.ReleaseGzipReader(gz) }, nil
	case "deflate":
		fr, err := providerUtils.AcquireFlateReader(r)
		if err != nil {
			return nil, nil, err
		}
		return fr, func() { providerUtils.ReleaseFlateReader(fr) }, nil
	case "br":
		br := providerUtils.AcquireBrotliReader(r)
		return br, func() { providerUtils.ReleaseBrotliReader(br) }, nil
	case "zstd":
		dec, err := providerUtils.AcquireZstdDecoder(r)
		if err != nil {
			return nil, nil, err
		}
		return dec, func() { providerUtils.ReleaseZstdDecoder(dec) }, nil
	default:
		return nil, nil, fmt.Errorf("%w: %q", fasthttp.ErrContentEncodingUnsupported, encoding)
	}
}

// TransportInterceptorMiddleware runs all plugin HTTP transport interceptors.
// It converts the fasthttp request to a serializable HTTPRequest, runs all plugin interceptors,
// and applies any modifications back to the fasthttp context.
func TransportInterceptorMiddleware(config *lib.Config) schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			plugins := config.GetLoadedHTTPTransportPlugins()
			if len(plugins) == 0 {
				next(ctx)
				return
			}
			// Get or create BifrostContext from fasthttp context
			bifrostCtx := getBifrostContextFromFastHTTP(ctx)
			// Acquire pooled request
			req := schemas.AcquireHTTPRequest()
			defer schemas.ReleaseHTTPRequest(req)
			fasthttpToHTTPRequest(ctx, req)
			// Run plugin interceptors
			for _, plugin := range plugins {
				pluginName := plugin.GetName()
				pluginCtx := bifrostCtx.WithPluginScope(&pluginName)
				resp, err := plugin.HTTPTransportPreHook(pluginCtx, req)
				pluginCtx.ReleasePluginScope()
				if err != nil {
					// Short-circuit with error — drain plugin logs before returning
					if logs := bifrostCtx.DrainPluginLogs(); len(logs) > 0 {
						ctx.SetUserValue(schemas.BifrostContextKeyTransportPluginLogs, logs)
					}
					ctx.SetStatusCode(fasthttp.StatusInternalServerError)
					ctx.SetBodyString(err.Error())
					return
				}
				if resp != nil {
					// Short-circuit with response — drain plugin logs before returning
					if logs := bifrostCtx.DrainPluginLogs(); len(logs) > 0 {
						ctx.SetUserValue(schemas.BifrostContextKeyTransportPluginLogs, logs)
					}
					applyHTTPResponseToCtx(ctx, resp)
					return
				}
				// If we got here, the plugin may have modified req in-place
			}
			// Drain pre-hook plugin logs and store on fasthttp context for trace attachment
			if preHookLogs := bifrostCtx.DrainPluginLogs(); len(preHookLogs) > 0 {
				ctx.SetUserValue(schemas.BifrostContextKeyTransportPluginLogs, preHookLogs)
			}
			// Apply modifications back to fasthttp context
			applyHTTPRequestToCtx(ctx, req)
			// Adding user values
			for key, value := range bifrostCtx.GetUserValues() {
				ctx.SetUserValue(key, value)
			}
			next(ctx)

			// For streaming responses, store a callback to run post-hooks after the stream ends.
			// The streaming handler calls this BEFORE reader.Done() so that errors can
			// still be sent as SSE events. applyResponse=false because the response is
			// already on the wire and mutating ctx.Response would corrupt the chunked stream.
			//
			// IMPORTANT: The callback must NOT access ctx — fasthttp recycles RequestCtx
			// after the response body stream completes. All needed data is eagerly captured
			// here (while ctx is still valid) and passed through the closure.
			if deferred, ok := ctx.UserValue(schemas.BifrostContextKeyDeferTraceCompletion).(bool); ok && deferred {
				// Verify the completer slot exists before allocating pooled snapshots.
				// The streaming handler pre-allocates this *atomic.Value; if absent,
				// skip work to avoid leaking pooled HTTPRequest/HTTPResponse objects.
				slot, ok := ctx.UserValue(schemas.BifrostContextKeyTransportPostHookCompleter).(*atomic.Value)
				if !ok {
					return
				}

				// Eagerly snapshot request/response from ctx before it can be recycled.
				capturedReq := lib.BuildHTTPRequestFromFastHTTP(ctx)
				capturedResp := lib.BuildHTTPResponseFromFastHTTP(ctx)
				// Snapshot pre-hook transport plugin logs already accumulated on ctx.
				var preHookLogs []schemas.PluginLogEntry
				if logs, ok := ctx.UserValue(schemas.BifrostContextKeyTransportPluginLogs).([]schemas.PluginLogEntry); ok {
					preHookLogs = logs
				}

				completer := func() ([]schemas.PluginLogEntry, error) {
					defer schemas.ReleaseHTTPRequest(capturedReq)
					defer schemas.ReleaseHTTPResponse(capturedResp)
					postHookLogs, err := runTransportPostHooksCaptured(capturedReq, capturedResp, plugins, bifrostCtx)
					allLogs := preHookLogs
					if len(postHookLogs) > 0 {
						allLogs = append(allLogs, postHookLogs...)
					}
					return allLogs, err
				}

				// Store the completer in the atomic.Value slot that the streaming handler
				// placed on ctx. The goroutine reads from its closure-captured copy of
				// the slot, avoiding any ctx access after the handler returns.
				slot.Store(completer)
				return
			}

			_ = runTransportPostHooks(ctx, plugins, bifrostCtx, true)
		}
	}
}

// runTransportPostHooks runs HTTPTransportPostHook for all plugins in reverse order,
// drains plugin logs, and applies the response back to the fasthttp context.
// Used for both non-streaming (inline) and streaming (deferred callback) paths.
//
// Transport-level plugin logs are stored in fasthttp UserValues (keyed by
// BifrostContextKeyTransportPluginLogs) rather than directly on BifrostContext,
// because transport hooks operate at the fasthttp layer before/after the core
// BifrostContext lifecycle. These logs are merged into the trace by the
// TracingMiddleware at trace completion, alongside core-level plugin logs
// which travel through BifrostContext → Trace → AttachPluginLogs.
func runTransportPostHooks(ctx *fasthttp.RequestCtx, plugins []schemas.HTTPTransportPlugin, bifrostCtx *schemas.BifrostContext, applyResponse bool) error {
	shouldApplyShortCircuit := applyResponse
	httpResp := schemas.AcquireHTTPResponse()
	defer schemas.ReleaseHTTPResponse(httpResp)
	fasthttpResponseToHTTPResponse(ctx, httpResp)

	// Build request from current fasthttp state (original pooled req may have been released)
	req := schemas.AcquireHTTPRequest()
	defer schemas.ReleaseHTTPRequest(req)
	fasthttpToHTTPRequest(ctx, req)

	// Run http post-hooks in reverse order
	for i := len(plugins) - 1; i >= 0; i-- {
		plugin := plugins[i]
		pluginName := plugin.GetName()
		pluginCtx := bifrostCtx.WithPluginScope(&pluginName)
		err := plugin.HTTPTransportPostHook(pluginCtx, req, httpResp)
		pluginCtx.ReleasePluginScope()
		if err != nil {
			logger.Warn("error in HTTPTransportPostHook for plugin %s: %s", pluginName, err.Error())
			// Drain plugin logs before returning on error
			if postHookLogs := bifrostCtx.DrainPluginLogs(); len(postHookLogs) > 0 {
				if existing, ok := ctx.UserValue(schemas.BifrostContextKeyTransportPluginLogs).([]schemas.PluginLogEntry); ok {
					ctx.SetUserValue(schemas.BifrostContextKeyTransportPluginLogs, append(existing, postHookLogs...))
				} else {
					ctx.SetUserValue(schemas.BifrostContextKeyTransportPluginLogs, postHookLogs)
				}
			}
			if shouldApplyShortCircuit {
				applyHTTPResponseToCtx(ctx, httpResp)
			}
			return fmt.Errorf("transport post-hook plugin %s: %w", pluginName, err)
		}
	}
	// Drain post-hook plugin logs and merge with pre-hook logs
	if postHookLogs := bifrostCtx.DrainPluginLogs(); len(postHookLogs) > 0 {
		if existing, ok := ctx.UserValue(schemas.BifrostContextKeyTransportPluginLogs).([]schemas.PluginLogEntry); ok {
			ctx.SetUserValue(schemas.BifrostContextKeyTransportPluginLogs, append(existing, postHookLogs...))
		} else {
			ctx.SetUserValue(schemas.BifrostContextKeyTransportPluginLogs, postHookLogs)
		}
	}
	if shouldApplyShortCircuit {
		applyHTTPResponseToCtx(ctx, httpResp)
	}
	return nil
}

// runTransportPostHooksCaptured is the goroutine-safe variant of runTransportPostHooks.
// It uses pre-captured HTTPRequest and HTTPResponse snapshots instead of reading from
// a fasthttp RequestCtx, which may have been recycled by the time this runs in a
// streaming goroutine. Returns accumulated plugin logs (instead of writing them to
// ctx.UserValue) so the caller can forward them to the trace completer.
func runTransportPostHooksCaptured(capturedReq *schemas.HTTPRequest, capturedResp *schemas.HTTPResponse, plugins []schemas.HTTPTransportPlugin, bifrostCtx *schemas.BifrostContext) ([]schemas.PluginLogEntry, error) {
	// Clone into fresh pooled objects so plugins can mutate without affecting the snapshots.
	req := schemas.AcquireHTTPRequest()
	defer schemas.ReleaseHTTPRequest(req)
	req.Method = capturedReq.Method
	req.Path = capturedReq.Path
	for k, v := range capturedReq.Headers {
		req.Headers[k] = v
	}
	for k, v := range capturedReq.Query {
		req.Query[k] = v
	}
	for k, v := range capturedReq.PathParams {
		req.PathParams[k] = v
	}

	httpResp := schemas.AcquireHTTPResponse()
	defer schemas.ReleaseHTTPResponse(httpResp)
	httpResp.StatusCode = capturedResp.StatusCode
	for k, v := range capturedResp.Headers {
		httpResp.Headers[k] = v
	}

	var allLogs []schemas.PluginLogEntry

	// Run http post-hooks in reverse order
	for i := len(plugins) - 1; i >= 0; i-- {
		plugin := plugins[i]
		pluginName := plugin.GetName()
		pluginCtx := bifrostCtx.WithPluginScope(&pluginName)
		err := plugin.HTTPTransportPostHook(pluginCtx, req, httpResp)
		pluginCtx.ReleasePluginScope()
		if err != nil {
			logger.Warn("error in HTTPTransportPostHook for plugin %s: %s", pluginName, err.Error())
			if postHookLogs := bifrostCtx.DrainPluginLogs(); len(postHookLogs) > 0 {
				allLogs = append(allLogs, postHookLogs...)
			}
			return allLogs, fmt.Errorf("transport post-hook plugin %s: %w", pluginName, err)
		}
	}
	// Drain post-hook plugin logs
	if postHookLogs := bifrostCtx.DrainPluginLogs(); len(postHookLogs) > 0 {
		allLogs = append(allLogs, postHookLogs...)
	}
	return allLogs, nil
}

// getBifrostContextFromFastHTTP gets or creates a BifrostContext from fasthttp context.
func getBifrostContextFromFastHTTP(ctx *fasthttp.RequestCtx) *schemas.BifrostContext {
	return schemas.NewBifrostContext(ctx, schemas.NoDeadline)
}

// fasthttpToHTTPRequest populates a pooled HTTPRequest from fasthttp context.
func fasthttpToHTTPRequest(ctx *fasthttp.RequestCtx, req *schemas.HTTPRequest) {
	req.Method = string(ctx.Method())
	req.Path = string(ctx.Path())

	// Copy headers
	for key, value := range ctx.Request.Header.All() {
		req.Headers[string(key)] = string(value)
	}

	// Copy query params
	for key, value := range ctx.Request.URI().QueryArgs().All() {
		req.Query[string(key)] = string(value)
	}

	// Copy path parameters from user values
	// The fasthttp router stores path variables (like {file_id}, {model}) as user values
	// We extract all string user values that are likely path parameters
	ctx.VisitUserValuesAll(func(key, value any) {
		// Only process string keys and string values
		keyStr, keyIsString := key.(string)
		valueStr, valueIsString := value.(string)
		if !keyIsString || !valueIsString {
			return
		}
		// Skip internal Bifrost system keys and tracing keys
		if strings.HasPrefix(keyStr, "bifrost-") ||
			keyStr == "BifrostContextKeyRequestID" ||
			keyStr == "trace_id" ||
			keyStr == "span_id" {
			return
		}
		// Store as path parameter
		req.PathParams[keyStr] = valueStr
	})

	// Skip body copy for large payloads.
	// Check threshold first (set by RequestThresholdMiddleware before this middleware runs)
	// because the large-payload-mode flag is only set later inside the handler hook.
	if threshold, ok := ctx.UserValue(schemas.BifrostContextKeyLargePayloadRequestThreshold).(int64); ok && threshold > 0 {
		cl := int64(ctx.Request.Header.ContentLength())
		// Skip body copy when CL exceeds threshold OR CL is unknown (streaming/
		// chunked, e.g. after streaming decompression deletes the header).
		if cl > threshold || cl < 0 {
			return
		}
	}
	if isLargePayload, ok := ctx.UserValue(schemas.BifrostContextKeyLargePayloadMode).(bool); ok && isLargePayload {
		return
	}
	body := ctx.Request.Body()
	if len(body) > 0 {
		req.Body = make([]byte, len(body))
		copy(req.Body, body)
	}
}

// applyHTTPRequestToCtx applies modifications from HTTPRequest back to fasthttp context.
func applyHTTPRequestToCtx(ctx *fasthttp.RequestCtx, req *schemas.HTTPRequest) {
	// If path/method is different, throw error
	if req.Method != string(ctx.Method()) || req.Path != string(ctx.Path()) {
		logger.Error("request method/path mismatch: %s %s != %s %s", req.Method, req.Path, string(ctx.Method()), string(ctx.Path()))
		SendError(ctx, fasthttp.StatusConflict, "request method/path was modified by a plugin, this is not allowed")
		return
	}
	// Apply headers
	for key, value := range req.Headers {
		ctx.Request.Header.Set(key, value)
	}
	// Apply query params
	for key, value := range req.Query {
		ctx.Request.URI().QueryArgs().Set(key, value)
	}
	// Apply body if set
	if req.Body != nil {
		ctx.Request.SetBody(req.Body)
	}
}

// applyHTTPResponseToCtx writes a short-circuit response to fasthttp context.
func applyHTTPResponseToCtx(ctx *fasthttp.RequestCtx, resp *schemas.HTTPResponse) {
	ctx.SetStatusCode(resp.StatusCode)
	for key, value := range resp.Headers {
		ctx.Response.Header.Set(key, value)
	}
	if resp.Body != nil {
		ctx.SetBody(resp.Body)
	}
}

// fasthttpResponseToHTTPResponse populates a pooled HTTPResponse from fasthttp context.
func fasthttpResponseToHTTPResponse(ctx *fasthttp.RequestCtx, resp *schemas.HTTPResponse) {
	resp.StatusCode = ctx.Response.StatusCode()
	for key, value := range ctx.Response.Header.All() {
		resp.Headers[string(key)] = string(value)
	}
	// Skip response body copy for streaming (SSE) responses — the body is an active
	// io.Reader consumed by fasthttp's writeBodyChunked. Calling Body() would race
	// with the chunked writer (Body() drains and closes the bodyStream).
	if deferred, ok := ctx.UserValue(schemas.BifrostContextKeyDeferTraceCompletion).(bool); ok && deferred {
		return
	}
	// Skip response body copy when large payload/response mode is active — the response is
	// streamed directly to the client and materializing it here would spike memory.
	if isLargePayload, ok := ctx.UserValue(schemas.BifrostContextKeyLargePayloadMode).(bool); ok && isLargePayload {
		return
	}
	if isLargeResponse, ok := ctx.UserValue(lib.FastHTTPUserValueLargeResponseMode).(bool); ok && isLargeResponse {
		return
	}
	// Also skip if response Content-Length exceeds the configured response threshold.
	if threshold, ok := ctx.UserValue(schemas.BifrostContextKeyLargeResponseThreshold).(int64); ok && threshold > 0 {
		if int64(ctx.Response.Header.ContentLength()) > threshold {
			return
		}
	}
	body := ctx.Response.Body()
	if len(body) > 0 {
		resp.Body = make([]byte, len(body))
		copy(resp.Body, body)
	}
}

// validateSession checks if a session token is valid
func validateSession(_ *fasthttp.RequestCtx, store configstore.ConfigStore, token string) bool {
	session, err := store.GetSession(context.Background(), token)
	if err != nil || session == nil {
		return false
	}
	if session.ExpiresAt.Before(time.Now()) {
		return false
	}
	return true
}

// validateDashboardSession validates a dashboard session token, transparently
// refreshing an expired Aone user session against the Aone refresh endpoint.
// Local-admin sessions are effectively non-expiring, so an expired admin session
// is simply treated as invalid. Aone sessions are tied to the access token's
// lifetime: on expiry we attempt a refresh-token exchange and, on success,
// extend the session (and re-set the cookie). Only when refresh fails is the
// user forced to re-authenticate.
func (m *AuthMiddleware) validateDashboardSession(ctx *fasthttp.RequestCtx, token string) bool {
	session, err := m.store.GetSession(ctx, token)
	if err != nil || session == nil {
		return false
	}
	if session.ExpiresAt.After(time.Now()) {
		return true
	}
	return refreshDashboardSession(ctx, m.store, session, token)
}

// refreshDashboardSession refreshes an expired dashboard session. Only Aone user
// sessions are eligible for server-side refresh (local-admin sessions are
// effectively non-expiring, so an expired one is simply invalid). On a
// successful Aone refresh-token exchange it persists the refreshed tokens,
// extends the session, re-sets the cookie, and returns true. Concurrent
// refreshes for the same token are coalesced via singleflight so Aone sees a
// single exchange (the refresh token may be single-use).
func refreshDashboardSession(ctx *fasthttp.RequestCtx, store configstore.ConfigStore, session *tables.SessionsTable, token string) bool {
	if session.AoneUserID == nil || strings.TrimSpace(*session.AoneUserID) == "" {
		return false
	}
	authConfig, err := store.GetAuthConfig(ctx)
	if err != nil || authConfig == nil || authConfig.AoneOAuth == nil || !authConfig.AoneOAuth.IsConfigured() {
		return false
	}
	loginSource := strings.TrimSpace(session.LoginSource)
	if loginSource == "" {
		loginSource = loginSourceDashboard
	}
	aoneUserID := strings.TrimSpace(*session.AoneUserID)

	result, err, _ := dashboardSessionRefreshGroup.Do(token, func() (any, error) {
		return doRefreshAoneSession(ctx, store, authConfig.AoneOAuth, aoneUserID, loginSource, token)
	})
	if err != nil || result == nil {
		return false
	}
	newExpiry, ok := result.(time.Time)
	if !ok {
		return false
	}
	// Re-set the cookie so the browser keeps the (refreshed) session alive.
	setSessionCookie(ctx, token, newExpiry)
	return true
}

// doRefreshAoneSession performs the actual Aone refresh-token exchange and
// persists the refreshed tokens + extended session expiry. Returns the new
// session expiry on success.
func doRefreshAoneSession(ctx context.Context, store configstore.ConfigStore, cfg *configstore.AoneOAuthConfig, aoneUserID, loginSource, token string) (time.Time, error) {
	tokenRow, err := store.GetAoneUserOAuthToken(ctx, aoneUserID, loginSource, token)
	if err != nil {
		return time.Time{}, err
	}
	if tokenRow == nil || strings.TrimSpace(tokenRow.RefreshToken) == "" {
		return time.Time{}, fmt.Errorf("no refresh token available for aone user %s", aoneUserID)
	}

	client := aoneoauth.NewClient(cfg.BaseURL.GetValue())
	tokenResp, err := client.RefreshAccessToken(ctx, tokenRow.RefreshToken, cfg.ClientID.GetValue(), cfg.ClientSecret.GetValue())
	if err != nil {
		return time.Time{}, err
	}
	// Some providers omit a rotated refresh token; keep the existing one so the
	// next refresh still works.
	if strings.TrimSpace(tokenResp.RefreshToken) == "" {
		tokenResp.RefreshToken = tokenRow.RefreshToken
	}
	if _, err := store.UpsertAoneUserOAuthToken(ctx, aoneUserID, loginSource, token, tokenResp); err != nil {
		return time.Time{}, err
	}
	newExpiry := aoneSessionExpiresAt(tokenResp)
	if err := store.UpdateSessionExpiry(ctx, token, newExpiry); err != nil {
		return time.Time{}, err
	}
	return newExpiry, nil
}

type sessionReader interface {
	GetSession(ctx context.Context, token string) (*tables.SessionsTable, error)
}

func validateLocalAdminSession(store sessionReader, token string) bool {
	session, err := store.GetSession(context.Background(), token)
	if err != nil || session == nil {
		return false
	}
	if session.ExpiresAt.Before(time.Now()) {
		return false
	}
	return session.AoneUserID == nil || *session.AoneUserID == ""
}

func validateGlobalAPIKey(ctx context.Context, store configstore.ConfigStore, token string) (*tables.GlobalAPIKey, error) {
	if store == nil {
		return nil, nil
	}
	return store.GetActiveGlobalAPIKeyByToken(ctx, token)
}

// deviceFingerprintHeader carries the caller's device fingerprint on forwarded
// API requests for personal Aone virtual keys.
const deviceFingerprintHeader = "X-Device-Fingerprint"

// enforceDeviceFingerprint strips the device fingerprint header from forwarding
// requests. Global API keys are admin credentials and are not gated by device
// fingerprint.
func (m *AuthMiddleware) enforceDeviceFingerprint(ctx *fasthttp.RequestCtx, _ *tables.GlobalAPIKey, path string) bool {
	if !isDeviceForwardingAPIPath(path) {
		return true
	}
	ctx.Request.Header.Del(deviceFingerprintHeader)
	return true
}

// gateDeviceOnForwarding enforces device-fingerprint gating for a forwarding
// (inference) request, even on code paths where normal authentication is skipped
// (DisableAuthOnInference or auth fully disabled). It resolves the Bearer credential
// to the Aone user it belongs to — a personal Aone virtual key (sk-bf-...) — and
// requires the X-Device-Fingerprint header to match an active device for that user,
// unless the request also carries a valid browser dashboard session cookie for
// the same user (prompt repository / web playground). Global API keys (bf-ak-...)
// are admin credentials and bypass device gating. Device-bound ZD Switch sessions
// still require fingerprint enforcement. The fingerprint header is always stripped
// from forwarding requests. Returns false (and writes a 401/500) when the request
// must be rejected; returns true (allowing the caller's normal flow) for
// non-forwarding paths, global API keys, web-session bypass, and credentials not
// tied to an Aone user.
func (m *AuthMiddleware) gateDeviceOnForwarding(ctx *fasthttp.RequestCtx, url string) bool {
	if m.store == nil || !isDeviceForwardingAPIPath(url) {
		return true
	}

	// Always strip the fingerprint header from forwarded requests.
	fingerprint := normalizeDeviceFingerprint(string(ctx.Request.Header.Peek(deviceFingerprintHeader)))
	ctx.Request.Header.Del(deviceFingerprintHeader)

	authorization := string(ctx.Request.Header.Peek("Authorization"))
	scheme, token, ok := strings.Cut(authorization, " ")
	if !ok || scheme != "Bearer" {
		return true
	}

	// A device-issued temporary credential (bf-tmp-...) is itself the
	// device-bound forwarding credential: validate it, enforce the fingerprint,
	// and rewrite the Authorization header to the user's virtual key.
	if matched, proceed := m.applyDeviceTemporaryCredential(ctx, token, fingerprint); matched {
		return proceed
	}

	if globalKey, err := validateGlobalAPIKey(ctx, m.store, token); err != nil {
		logger.Error("[aone-devices] failed to resolve global API key for forwarding: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Internal Server Error")
		return false
	} else if globalKey != nil {
		// Global API keys are admin credentials; allow forwarding without device gating.
		return true
	}

	userIDs, err := m.resolveDeviceGatedUsers(ctx, token)
	if err != nil {
		logger.Error("[aone-devices] failed to resolve device-gated users: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Internal Server Error")
		return false
	}
	if len(userIDs) == 0 {
		// Admin global key, non-Aone virtual key, or unrecognized token: not gated.
		return true
	}
	// Browser flows (prompt repository, dashboard) authenticate via access
	// token cookie; they do not carry a desktop device fingerprint.
	if m.bypassDeviceFingerprintForWebSession(ctx, userIDs) {
		return true
	}
	return m.checkDeviceFingerprint(ctx, userIDs, fingerprint)
}

// resolveDeviceGatedUsers maps a Bearer credential to the Aone user IDs whose
// devices gate it. A personal Aone virtual key resolves to its owning user.
// Global API keys and other credentials resolve to no users.
func (m *AuthMiddleware) resolveDeviceGatedUsers(ctx *fasthttp.RequestCtx, token string) ([]string, error) {
	globalKey, err := validateGlobalAPIKey(ctx, m.store, token)
	if err != nil {
		return nil, err
	}
	if globalKey != nil {
		return nil, nil
	}

	aoneUserID, err := m.store.GetAoneUserIDByVirtualKeyValue(ctx, token)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(aoneUserID) != "" {
		return []string{aoneUserID}, nil
	}
	return nil, nil
}

// checkDeviceFingerprint verifies the supplied fingerprint matches an active
// device authorization for one of the given Aone users, writing the appropriate
// 401/500 response and returning false when it does not.
func (m *AuthMiddleware) checkDeviceFingerprint(ctx *fasthttp.RequestCtx, userIDs []string, fingerprint string) bool {
	if fingerprint == "" {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized device: missing device fingerprint")
		return false
	}

	device, err := m.store.GetActiveAoneDeviceAuthorizationForUsers(ctx, userIDs, fingerprint)
	if err != nil {
		if errors.Is(err, configstore.ErrDeviceAuthorizationNotFound) {
			SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized device: device is not authorized for this user")
			return false
		}
		logger.Error("[aone-devices] failed to validate device fingerprint: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Internal Server Error")
		return false
	}

	// Record the latest forwarding access for the matched device (best-effort).
	if device != nil && device.ID > 0 {
		deviceID := device.ID
		go func() {
			if touchErr := m.store.TouchAoneDeviceAuthorizationLastAPIAccess(context.Background(), deviceID); touchErr != nil {
				logger.Warn("[aone-devices] failed to record last api access for device=%d: %v", deviceID, touchErr)
			}
		}()
	}
	return true
}

func isAoneDeviceBoundSession(session *tables.SessionsTable) bool {
	if session == nil {
		return false
	}
	return session.DeviceAuthorizationID != nil && *session.DeviceAuthorizationID > 0
}

// bypassDeviceFingerprintForWebSession allows browser-authenticated users (prompt
// repository, dashboard playground) to call inference APIs with their personal
// virtual key without a desktop device fingerprint. Device-bound ZD Switch sessions
// still require fingerprint enforcement.
func (m *AuthMiddleware) bypassDeviceFingerprintForWebSession(ctx *fasthttp.RequestCtx, userIDs []string) bool {
	if m.store == nil || len(userIDs) == 0 {
		return false
	}
	allowed := make(map[string]struct{}, len(userIDs))
	for _, id := range userIDs {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			allowed[trimmed] = struct{}{}
		}
	}
	sessionToken := strings.TrimSpace(string(ctx.Request.Header.Cookie("token")))
	if sessionToken == "" {
		return false
	}
	if !m.validateDashboardSession(ctx, sessionToken) {
		return false
	}
	session, err := m.store.GetSession(ctx, sessionToken)
	if err != nil || session == nil || session.AoneUserID == nil {
		return false
	}
	if isAoneDeviceBoundSession(session) {
		return false
	}
	_, ok := allowed[strings.TrimSpace(*session.AoneUserID)]
	return ok
}

// applyDeviceTemporaryCredential validates a device-issued temporary forwarding
// credential (bf-tmp-...) for a forwarding request. On success it rewrites the
// Authorization header to the owning user's internal virtual key so downstream
// governance/inference resolves it exactly as a normal VK credential — the VK
// is never exposed to the user. The supplied fingerprint must match the
// credential's bound device. It returns (matched, proceed):
//   - matched=false: token is not a temp credential; caller continues normally.
//   - matched=true, proceed=false: a 401/500 response was already written.
//   - matched=true, proceed=true: header rewritten; caller should run next.
func (m *AuthMiddleware) applyDeviceTemporaryCredential(ctx *fasthttp.RequestCtx, token, fingerprint string) (matched bool, proceed bool) {
	if m.store == nil || !strings.HasPrefix(token, configstore.AoneDeviceCredentialPrefix) {
		return false, false
	}

	cred, err := m.store.ResolveActiveAoneDeviceTemporaryCredential(ctx, token)
	if err != nil {
		if errors.Is(err, configstore.ErrDeviceCredentialNotFound) || errors.Is(err, configstore.ErrDeviceCredentialExpired) {
			SendError(ctx, fasthttp.StatusUnauthorized, "Invalid or expired credential")
			return true, false
		}
		logger.Error("[aone-devices] failed to resolve temporary credential: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Internal Server Error")
		return true, false
	}
	if fingerprint == "" {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized device: missing device fingerprint")
		return true, false
	}
	if cred.DeviceFingerprint != fingerprint {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized device: device fingerprint mismatch")
		return true, false
	}

	vk, err := m.store.GetVirtualKey(ctx, cred.VirtualKeyID)
	if err != nil || vk == nil || !vk.IsActiveValue() || strings.TrimSpace(vk.Value) == "" {
		SendError(ctx, fasthttp.StatusUnauthorized, "Invalid or expired credential")
		return true, false
	}

	// Rewrite the credential to the user's virtual key for downstream
	// governance, and drop any client-supplied x-bf-vk so it cannot be used to
	// escalate to a different key.
	ctx.Request.Header.Set("Authorization", "Bearer "+vk.Value)
	ctx.Request.Header.Del(string(schemas.BifrostContextKeyVirtualKey))

	credID := cred.ID
	deviceID := cred.DeviceAuthorizationID
	go func() {
		bg := context.Background()
		if touchErr := m.store.TouchAoneDeviceTemporaryCredentialLastUsed(bg, credID); touchErr != nil {
			logger.Warn("[aone-devices] failed to record credential use id=%d: %v", credID, touchErr)
		}
		if touchErr := m.store.TouchAoneDeviceAuthorizationLastAPIAccess(bg, deviceID); touchErr != nil {
			logger.Warn("[aone-devices] failed to record device access id=%d: %v", deviceID, touchErr)
		}
	}()
	return true, true
}

func applyGlobalAPIKeyAuth(ctx *fasthttp.RequestCtx, globalKey *tables.GlobalAPIKey) {
	ctx.SetUserValue(schemas.IsAPIKeyAuthContextKey, true)
	ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
	// Attribute global API key inference usage to the admin user in LLM/MCP logs.
	ctx.SetUserValue(schemas.BifrostContextKeyUserID, schemas.LocalAdminUserID)
	ctx.SetUserValue(schemas.BifrostContextKeyUserName, schemas.LocalAdminUserName)
	if globalKey != nil {
		ctx.SetUserValue(schemas.BifrostContextKeyGlobalAPIKeyID, globalKey.ID)
		ctx.SetUserValue(schemas.BifrostContextKeyGlobalAPIKeyName, globalKey.Name)
	}
}

// authenticateGlobalAPIKeyIfPresent validates Bearer bf-ak- credentials when they
// are presented on inference paths where normal auth is skipped. Returns false
// after writing an error response when validation fails.
func (m *AuthMiddleware) authenticateGlobalAPIKeyIfPresent(ctx *fasthttp.RequestCtx) bool {
	authorization := strings.TrimSpace(string(ctx.Request.Header.Peek("Authorization")))
	if authorization == "" {
		return true
	}
	scheme, token, ok := strings.Cut(authorization, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return true
	}
	if !strings.HasPrefix(token, configstore.GlobalAPIKeyPrefix) {
		return true
	}
	globalKey, err := validateGlobalAPIKey(ctx, m.store, token)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Internal Server Error")
		return false
	}
	if globalKey == nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
		return false
	}
	applyGlobalAPIKeyAuth(ctx, globalKey)
	return true
}

// isInferenceWSEndpoint returns true for WebSocket endpoints that should use
// standard inference auth (Bearer/Basic/VK) rather than dashboard session tokens.
func isInferenceWSEndpoint(path string) bool {
	for strings.HasPrefix(path, "/openai/") {
		path = strings.TrimPrefix(path, "/openai")
	}

	switch path {
	case "/v1/responses",
		"/responses",
		"/v1/realtime",
		"/realtime":
		return true
	default:
		return false
	}
}

func buildRealtimeTransportPathSet() map[string]struct{} {
	paths := map[string]struct{}{}
	for _, path := range integrations.OpenAIRealtimePaths("") {
		paths[path] = struct{}{}
	}
	for _, path := range integrations.OpenAIRealtimePaths("/openai") {
		paths[path] = struct{}{}
	}
	for _, path := range integrations.OpenAIRealtimeWebRTCCallsPaths("") {
		paths[path] = struct{}{}
	}
	for _, path := range integrations.OpenAIRealtimeWebRTCCallsPaths("/openai") {
		paths[path] = struct{}{}
	}
	return paths
}

func isRealtimeTransportEndpoint(path string) bool {
	_, ok := realtimeTransportPaths[path]
	return ok
}

// VirtualKeyReloader reloads a virtual key into the in-memory governance store.
type VirtualKeyReloader interface {
	ReloadVirtualKey(ctx context.Context, id string) (*tables.TableVirtualKey, error)
}

// AuthMiddleware is a middleware that handles authentication for the API.
type AuthMiddleware struct {
	store             configstore.ConfigStore
	whitelistedRoutes atomic.Pointer[[]string]
	authConfig        atomic.Pointer[configstore.AuthConfig]
	wsTicketStore     *WSTicketStore
	tempTokensService *temptoken.Service // optional; when nil, temp-token fallback is disabled
	tempTokensEnabled atomic.Bool
}

// dashboardSessionRefreshGroup de-duplicates concurrent Aone token refreshes for
// the same dashboard session, so a burst of requests after expiry triggers a
// single refresh-token exchange (Aone may rotate/burn the refresh token). It is
// package-level so the auth middleware and the (whitelisted) is-auth-enabled
// endpoint coalesce against the same in-flight refresh.
var dashboardSessionRefreshGroup singleflight.Group

// InitAuthMiddleware initializes the auth middleware. The tempTokens service
// is optional and still gated by client config — when nil or disabled, the
// temp-token fallback path is skipped.
func InitAuthMiddleware(store configstore.ConfigStore, wsTicketStore *WSTicketStore, tempTokensService *temptoken.Service) (*AuthMiddleware, error) {
	if store == nil {
		return nil, fmt.Errorf("store is not present")
	}
	authConfig, err := store.GetAuthConfig(context.Background())
	if err != nil {
		return nil, fmt.Errorf("failed to get auth config from store: %v", err)
	}
	am := &AuthMiddleware{
		store:             store,
		authConfig:        atomic.Pointer[configstore.AuthConfig]{},
		wsTicketStore:     wsTicketStore,
		tempTokensService: tempTokensService,
	}

	am.authConfig.Store(authConfig)

	// Load whitelisted routes from client config
	clientConfig, err := store.GetClientConfig(context.Background())
	if err == nil && clientConfig != nil {
		am.whitelistedRoutes.Store(&clientConfig.WhitelistedRoutes)
		am.tempTokensEnabled.Store(clientConfig.MCPEnableTempTokenAuth)
	} else {
		emptyRoutes := []string{}
		am.whitelistedRoutes.Store(&emptyRoutes)
		am.tempTokensEnabled.Store(false)
	}

	return am, nil
}

func (m *AuthMiddleware) UpdateAuthConfig(authConfig *configstore.AuthConfig) {
	m.authConfig.Store(authConfig)
}

// UpdateWhitelistedRoutes updates the configured whitelisted routes that bypass auth middleware.
func (m *AuthMiddleware) UpdateWhitelistedRoutes(routes []string) {
	m.whitelistedRoutes.Store(&routes)
}

// UpdateTempTokenAuthEnabled updates whether scoped temp-token fallback auth is accepted.
func (m *AuthMiddleware) UpdateTempTokenAuthEnabled(enabled bool) {
	m.tempTokensEnabled.Store(enabled)
}

// MarkAoneVirtualKeyReloaded records that a virtual key is already present in the governance store.
func MarkAoneVirtualKeyReloaded(vkID string) {
	if vkID != "" {
		reloadedAoneVirtualKeys.Store(vkID, true)
	}
}

// tryTempTokenOrUnauthorized is the last-resort auth path: a request that
// failed every conventional credential check (no Authorization header, no
// valid cookie) is given one more chance to present an X-Bifrost-Temp-Token
// header that authorizes the specific (method, path) being requested. On
// success the validated scope and resource_id are attached to ctx for
// handler-side defense-in-depth checks, and the next handler runs. On
// failure (no header, expired, route-mismatch, etc.) a 401 is written.
//
// Temp-token validation is intentionally *not* attempted when an
// Authorization header or session cookie is present — those paths have
// their own success/failure semantics and silently rescuing a bad password
// with a temp token would be surprising.
func (m *AuthMiddleware) tryTempTokenOrUnauthorized(ctx *fasthttp.RequestCtx, next fasthttp.RequestHandler) {
	if m.tempTokensService != nil && m.tempTokensEnabled.Load() {
		token := string(ctx.Request.Header.Peek("X-Bifrost-Temp-Token"))
		if token != "" {
			validated, err := m.tempTokensService.Validate(ctx, token, string(ctx.Method()), string(ctx.Path()))
			if err == nil && validated != nil {
				ctx.SetUserValue(schemas.BifrostContextKeyTempTokenScope, validated.Scope)
				ctx.SetUserValue(schemas.BifrostContextKeyTempTokenResourceID, validated.ResourceID)
				next(ctx)
				return
			}
		}
	}
	SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
}

func isPublicLoginUIPath(url string) bool {
	return url == "/login" || strings.HasPrefix(url, "/login/")
}

// InferenceMiddleware is for inference requests (including MCP routes) if authConfig is set, it will skip authentication if disableAuthOnInference is true.
func (m *AuthMiddleware) InferenceMiddleware() schemas.BifrostHTTPMiddleware {
	return m.middleware(func(authConfig *configstore.AuthConfig, url string) bool {
		return authConfig.DisableAuthOnInference
	})
}

// APIMiddleware is for API requests if authConfig is set, it will verify authentication based on the request type.
// Three authentication methods are supported:
//   - Basic auth: Uses username + password validation (no session tracking). Used for inference API calls.
//   - Bearer token: Uses session validation via validateSession(). Used for dashboard calls.
//   - WebSocket: Uses session validation via validateSession() with token from query parameters.
//
// Basic auth may be acceptable for limited use cases, while Bearer and WebSocket flows provide
// session-based authentication suitable for production environments.
func (m *AuthMiddleware) APIMiddleware() schemas.BifrostHTTPMiddleware {
	systemWhitelistedRoutes := []string{
		"/api/session/is-auth-enabled",
		"/api/session/login",
		"/api/config/website",
		"/api/oauth/callback",
		"/api/aone/oauth/config",
		"/api/aone/oauth/authorize",
		"/api/aone/oauth/callback",
		"/api/aone/oauth/zwitch/callback",
		"/api/aone/oauth/zwitch/handoff",
		"/api/aone/devices/token",
		"/api/aone/devices/revoke",
		"/health",
		"/",
		"/login",
		"/favicon.ico",
		"/assets/*",
		"/api/scim/oauth/config",
		"/api/scim/oauth/callback",
		"/api/scim/oauth/refresh",
		"/api/scim/oauth/logout",
		"/health",
		"/api/version",
	}
	whitelistedPrefixes := []string{
		// "/api/oauth/callback" is also in systemWhitelistedRoutes above as an
		// exact match — that's the only OAuth route that must be public (it's
		// hit by the browser after the upstream provider redirects back, with
		// no cookie context). DO NOT add a broad "/api/oauth" prefix here:
		// it would whitelist /api/oauth/per-user/* (auth-via-temp-token) and
		// /api/oauth/config/* (admin-only) and bypass the temp-token fallback
		// in tryTempTokenOrUnauthorized.
		"/api/dev",
		// Tauri updater check for Zwitch desktop clients (no auth).
		"/api/aone/zwitch/updates/",
	}
	return m.middleware(func(authConfig *configstore.AuthConfig, url string) bool {
		if isPublicLoginUIPath(url) ||
			slices.Contains(systemWhitelistedRoutes, url) ||
			slices.IndexFunc(whitelistedPrefixes, func(prefix string) bool {
				return strings.HasPrefix(url, prefix)
			}) != -1 {
			return true
		}
		// Check user-configured whitelisted routes
		if configuredRoutes := m.whitelistedRoutes.Load(); configuredRoutes != nil {
			if slices.Contains(*configuredRoutes, url) || slices.IndexFunc(*configuredRoutes, func(route string) bool {
				if strings.HasSuffix(route, "*") {
					return strings.HasPrefix(url, strings.TrimSuffix(route, "*"))
				}
				return false
			}) != -1 {
				return true
			}
		}
		return false
	})
}

// middleware is the core authentication middleware that checks if the request should be authenticated or not.
func (m *AuthMiddleware) middleware(shouldSkip func(*configstore.AuthConfig, string) bool) schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			// We will first check if its API key auth
			// If yes; we will skip this middleware
			if isAPIKeyAuth, ok := ctx.UserValue(schemas.IsAPIKeyAuthContextKey).(bool); ok && isAPIKeyAuth {
				next(ctx)
				return
			}
			authConfig := m.authConfig.Load()
			if authConfig == nil || !authConfig.IsEnabled {
				// logger.Debug("auth middleware is disabled because auth config is not present or not enabled")
				// Even with auth disabled, a credential presented on a forwarding
				// request must still pass device-fingerprint gating.
				if !m.gateDeviceOnForwarding(ctx, string(ctx.Path())) {
					return
				}
				ctx.SetUserValue(schemas.BifrostContextKeySessionToken, "")
				// Mark as local admin so downstream RBAC bypasses cleanly when
				// auth is fully disabled; otherwise RBAC 401s and the UI enters
				// a logout/login redirect loop.
				ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
				next(ctx)
				return
			}
			// Match the whitelist against the path only
			url := string(ctx.Path())
			// We skip authorization for the login route
			if shouldSkip(authConfig, url) {
				// Inference auth may be disabled (DisableAuthOnInference), but a
				// credential on a forwarding request must still pass device gating.
				if !m.gateDeviceOnForwarding(ctx, url) {
					return
				}
				if !m.authenticateGlobalAPIKeyIfPresent(ctx) {
					return
				}
				next(ctx)
				return
			}
			if isRealtimeTransportEndpoint(string(ctx.Path())) {
				next(ctx)
				return
			}
			// If inference is disabled, we skip authorization
			// Get the authorization header
			authorization := string(ctx.Request.Header.Peek("Authorization"))
			if authorization == "" {
				if string(ctx.Request.Header.Peek("Upgrade")) == "websocket" {
					path := string(ctx.Path())
					if isInferenceWSEndpoint(path) {
						// Inference WS endpoints (/v1/responses, /v1/realtime) use the same
						// auth as HTTP inference: Bearer/Basic headers or governance VK validation.
						// If no Authorization header, fall through to return 401 below
						// (or the shouldSkip check above already passed them through).
					} else {
						// Prefer short-lived ticket-based auth (from POST /api/session/ws-ticket)
						ticket := string(ctx.Request.URI().QueryArgs().Peek("ticket"))
						if ticket != "" && m.wsTicketStore != nil {
							sessionToken := m.wsTicketStore.Consume(ticket)
							if sessionToken != "" && validateSession(ctx, m.store, sessionToken) {
								ctx.SetUserValue(schemas.BifrostContextKeySessionToken, sessionToken)
								next(ctx)
								return
							}
							SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
							return
						}
						// Fallback: legacy ?token= param (for backward compatibility)
						token := string(ctx.Request.URI().QueryArgs().Peek("token"))
						if token != "" {
							if validateSession(ctx, m.store, token) {
								ctx.SetUserValue(schemas.BifrostContextKeySessionToken, token)
								next(ctx)
								return
							}
							SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
							return
						}
						// Fallback: cookie-based WS auth
						cookieToken := string(ctx.Request.Header.Cookie("token"))
						if cookieToken != "" && validateSession(ctx, m.store, cookieToken) {
							ctx.SetUserValue(schemas.BifrostContextKeySessionToken, cookieToken)
							next(ctx)
							return
						}
						SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
						return
					}
				}
				// Cookie-based auth fallback: if no Authorization header, check for the HTTPOnly session cookie.
				// This supports the dashboard which relies on cookies instead of localStorage tokens.
				cookieToken := string(ctx.Request.Header.Cookie("token"))
				if cookieToken != "" && m.validateDashboardSession(ctx, cookieToken) {
					ctx.SetUserValue(schemas.BifrostContextKeySessionToken, cookieToken)
					if validateLocalAdminSession(m.store, cookieToken) {
						ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
					}
					recordDeviceForwardingAccessIfApplicable(m.store, cookieToken, url)
					next(ctx)
					return
				}
				// Last-resort: a scoped temp token (e.g. for the MCP per-user
				// OAuth auth page accessed by a non-admin browser) can rescue
				// this request when it targets a route the token authorizes.
				m.tryTempTokenOrUnauthorized(ctx, next)
				return
			}
			// Split the authorization header into the scheme and the token
			scheme, token, ok := strings.Cut(authorization, " ")
			if !ok {
				SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
				return
			}
			// Checking basic auth for inference calls
			if scheme == "Basic" {
				// Decode the base64 token
				decodedBytes, err := base64.StdEncoding.DecodeString(token)
				if err != nil {
					SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
					return
				}
				// Split the decoded token into the username and password
				username, password, ok := strings.Cut(string(decodedBytes), ":")
				if !ok {
					SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
					return
				}
				// Verify the username and password
				if authConfig.AdminUserName == nil || username != authConfig.AdminUserName.GetValue() {
					SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
					return
				}
				if authConfig.AdminPassword == nil {
					SendError(ctx, fasthttp.StatusInternalServerError, "Authentication not properly configured")
					return
				}
				compare, err := encrypt.CompareHash(authConfig.AdminPassword.GetValue(), password)
				if err != nil {
					SendError(ctx, fasthttp.StatusInternalServerError, "Internal Server Error")
					return
				}
				if !compare {
					SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
					return
				}
				ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
				ctx.SetUserValue(schemas.BifrostContextKeyUserID, schemas.LocalAdminUserID)
				ctx.SetUserValue(schemas.BifrostContextKeyUserName, schemas.LocalAdminUserName)
				next(ctx)
				return
			}
			// Checking bearer auth for dashboard calls
		if scheme == "Bearer" {
			// A device-issued temporary credential (bf-tmp-...) on a forwarding
			// path is the device-bound AI credential: validate it, enforce the
			// fingerprint, and rewrite Authorization to the user's virtual key.
			if isDeviceForwardingAPIPath(url) && strings.HasPrefix(token, configstore.AoneDeviceCredentialPrefix) {
				fingerprint := normalizeDeviceFingerprint(string(ctx.Request.Header.Peek(deviceFingerprintHeader)))
				ctx.Request.Header.Del(deviceFingerprintHeader)
				if matched, proceed := m.applyDeviceTemporaryCredential(ctx, token, fingerprint); matched {
					if !proceed {
						return
					}
					next(ctx)
					return
				}
			}
			// We are checking for API keys first; it it seems like a valid Bifrost API key

				// Verify the session
				if !m.validateDashboardSession(ctx, token) {
					if globalKey, err := validateGlobalAPIKey(ctx, m.store, token); err != nil {
						SendError(ctx, fasthttp.StatusInternalServerError, "Internal Server Error")
						return
					} else if globalKey != nil {
						if !m.enforceDeviceFingerprint(ctx, globalKey, url) {
							return
						}
						applyGlobalAPIKeyAuth(ctx, globalKey)
						next(ctx)
						return
					}
					// Here we will check if its the base64 of username:password
					// This is for backward compatibility with the old auth system
					decodedBytes, err := base64.StdEncoding.DecodeString(token)
					if err != nil {
						SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
						return
					}
					username, password, ok := strings.Cut(string(decodedBytes), ":")
					if !ok {
						SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
						return
					}
					// Verify the username and password
					if authConfig.AdminUserName == nil || username != authConfig.AdminUserName.GetValue() {
						SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
						return
					}
					if authConfig.AdminPassword == nil {
						SendError(ctx, fasthttp.StatusInternalServerError, "Authentication not properly configured")
						return
					}
					compare, err := encrypt.CompareHash(authConfig.AdminPassword.GetValue(), password)
					if err != nil {
						SendError(ctx, fasthttp.StatusInternalServerError, "Internal Server Error")
						return
					}
					if !compare {
						SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
						return
					}
					ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
					ctx.SetUserValue(schemas.BifrostContextKeyUserID, schemas.LocalAdminUserID)
					ctx.SetUserValue(schemas.BifrostContextKeyUserName, schemas.LocalAdminUserName)
					next(ctx)
					return
				}
				// setting up session in the request
				ctx.SetUserValue(schemas.BifrostContextKeySessionToken, token)
				if validateLocalAdminSession(m.store, token) {
					ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
				}
				recordDeviceForwardingAccessIfApplicable(m.store, token, url)
				// Continue with the next handler
				next(ctx)
				return
			}
			SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
		}
	}
}

// TracingMiddleware creates distributed traces for requests and forwards completed traces
// to observability plugins after the response has been written.
//
// The middleware:
// 1. Extracts parent trace ID from incoming W3C traceparent header (if present)
// 2. Creates a new trace in the store (only the lightweight trace ID is stored in context)
// 3. Calls the next handler to process the request
// 4. After response is written, asynchronously completes the trace and forwards it to observability plugins
//
// This middleware should be placed early in the middleware chain to capture the full request lifecycle.
type TracingMiddleware struct {
	tracer atomic.Pointer[tracing.Tracer]
}

func attachDimensionAttributesToHTTPSpan(ctx *fasthttp.RequestCtx, setAttribute func(key string, value any)) {
	if ctx == nil || setAttribute == nil {
		return
	}
	// Root HTTP span starts before ConvertToBifrostContext, so read x-bf-dim-* directly.
	ctx.Request.Header.All()(func(key, value []byte) bool {
		keyStr := strings.ToLower(string(key))
		if labelName, ok := strings.CutPrefix(keyStr, "x-bf-dim-"); ok && labelName != "" {
			if labelName != "path" && labelName != "method" {
				setAttribute(labelName, string(value))
			}
		}
		return true
	})
}

// NewTracingMiddleware creates a new tracing middleware
func NewTracingMiddleware(tracer *tracing.Tracer) *TracingMiddleware {
	tm := &TracingMiddleware{
		tracer: atomic.Pointer[tracing.Tracer]{},
	}
	tm.tracer.Store(tracer)
	return tm
}

// SetObservabilityPlugins sets the observability plugins for the tracing middleware
func (m *TracingMiddleware) SetObservabilityPlugins(obsPlugins []schemas.ObservabilityPlugin) {
	if tracer := m.tracer.Load(); tracer != nil {
		tracer.SetObservabilityPlugins(obsPlugins)
	}
}

// SetTracer sets the tracer for the tracing middleware
func (m *TracingMiddleware) SetTracer(tracer *tracing.Tracer) {
	m.tracer.Store(tracer)
}

// Middleware returns the middleware function that creates distributed traces for requests and forwards completed traces
func (m *TracingMiddleware) Middleware() schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			// Pin the tracer for the lifetime of this request so that a concurrent
			// SetTracer() swap cannot split a trace across two instances.
			tracer := m.tracer.Load()
			if tracer == nil {
				next(ctx)
				return
			}
			requestID := string(ctx.Request.Header.Peek("x-request-id"))
			if requestID == "" {
				requestID = uuid.New().String()
				// Injecting this back to be picked up by the next middleware
				ctx.Request.Header.Set("x-request-id", requestID)
			}
			// Extract trace ID from W3C traceparent header (if present)
			// This is the 32-char trace ID that links all spans in a distributed trace
			inheritedTraceID := tracing.ExtractParentID(&ctx.Request.Header)
			// Create trace in store - only ID returned (trace data stays in store)
			traceID := tracer.CreateTrace(inheritedTraceID, requestID)
			// Only trace ID goes into context (lightweight, no bloat)
			ctx.SetUserValue(schemas.BifrostContextKeyTraceID, traceID)
			// Extract parent span ID from W3C traceparent header (if present)
			// This is the 16-char span ID from the upstream service that should be
			// set as the ParentID of our root span for proper trace linking in Datadog/etc.
			parentSpanID := tracing.ExtractTraceParentSpanID(&ctx.Request.Header)
			if parentSpanID != "" {
				ctx.SetUserValue(schemas.BifrostContextKeyParentSpanID, parentSpanID)
			}
			// Store a trace completion callback for streaming handlers to use.
			// Accepts transport plugin logs as a parameter so it never reads from
			// ctx.UserValue — ctx may be recycled by the time this runs in a goroutine.
			ctx.SetUserValue(schemas.BifrostContextKeyTraceCompleter, func(transportLogs []schemas.PluginLogEntry) {
				if len(transportLogs) > 0 {
					tracer.AttachPluginLogs(traceID, transportLogs)
				}
				// End the root HTTP span now that the stream has fully drained, so its
				// latency covers the entire streamed response. For deferred (streaming)
				// requests the TracingMiddleware defer below intentionally leaves the root
				// span open; ending it here keeps the parent from closing before its child
				// llm.call span (which is ended by completeDeferredSpan on the final chunk).
				// Status is always Ok: deferral is only set after the stream was set up with
				// HTTP 200, and mid-stream failures surface as SSE error frames / on the
				// llm.call span, not as an HTTP error on the root.
				if rootHandle := tracer.GetSpanHandleByID(traceID, nil); rootHandle != nil {
					tracer.EndSpan(rootHandle, schemas.SpanStatusOk, "")
				}
				tracer.CompleteAndFlushTrace(traceID)
			})
			// Create root span for the HTTP request
			spanCtx, rootSpan := tracer.StartSpan(ctx, string(ctx.RequestURI()), schemas.SpanKindHTTPRequest)
			if rootSpan != nil {
				attachDimensionAttributesToHTTPSpan(ctx, func(key string, value any) {
					tracer.SetAttribute(rootSpan, key, value)
				})
				tracer.SetAttribute(rootSpan, "http.method", string(ctx.Method()))
				tracer.SetAttribute(rootSpan, "http.url", string(ctx.RequestURI()))
				tracer.SetAttribute(rootSpan, "http.user_agent", string(ctx.Request.Header.UserAgent()))
				// Set root span ID in context for child span creation
				if spanID, ok := spanCtx.Value(schemas.BifrostContextKeySpanID).(string); ok {
					ctx.SetUserValue(schemas.BifrostContextKeySpanID, spanID)
				}
			}
			defer func() {
				deferred, _ := ctx.UserValue(schemas.BifrostContextKeyDeferTraceCompletion).(bool)
				// Record response status on the root span
				if rootSpan != nil {
					tracer.SetAttribute(rootSpan, "http.status_code", ctx.Response.StatusCode())
					// For deferred (streaming) requests, the trace completer ends the root
					// span after the stream fully drains, so its latency reflects the whole
					// streamed response. Ending it here (at handler return) would close the
					// parent before the deferred llm.call span finishes, making the child
					// span appear longer than its parent in trace viewers.
					if !deferred {
						if ctx.Response.StatusCode() >= 400 {
							tracer.EndSpan(rootSpan, schemas.SpanStatusError, fmt.Sprintf("HTTP %d", ctx.Response.StatusCode()))
						} else {
							tracer.EndSpan(rootSpan, schemas.SpanStatusOk, "")
						}
					}
				}
				// Check if trace completion is deferred (for streaming requests)
				// If deferred, the streaming handler will complete the trace (and end the
				// root span via the trace completer) after the stream ends.
				if deferred {
					return
				}
				// Attach transport plugin logs to trace before completion
				if transportLogs, ok := ctx.UserValue(schemas.BifrostContextKeyTransportPluginLogs).([]schemas.PluginLogEntry); ok && len(transportLogs) > 0 {
					tracer.AttachPluginLogs(traceID, transportLogs)
				}
				// After response written - async flush
				tracer.CompleteAndFlushTrace(traceID)
			}()

			next(ctx)
		}
	}
}

// GetTracer returns the tracer instance for use by streaming handlers
func (m *TracingMiddleware) GetTracer() *tracing.Tracer {
	return m.tracer.Load()
}

// GetObservabilityPlugins filters and returns only observability plugins from a list of plugins.
// Uses Go type assertion to identify plugins implementing the ObservabilityPlugin interface.
func GetObservabilityPlugins(plugins []schemas.BasePlugin) []schemas.ObservabilityPlugin {
	if len(plugins) == 0 {
		return nil
	}

	obsPlugins := make([]schemas.ObservabilityPlugin, 0)
	for _, plugin := range plugins {
		if obsPlugin, ok := plugin.(schemas.ObservabilityPlugin); ok {
			obsPlugins = append(obsPlugins, obsPlugin)
		}
	}

	return obsPlugins
}
