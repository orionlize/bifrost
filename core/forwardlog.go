package bifrost

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/valyala/fasthttp"
)

const forwardErrorLogRawResponseMaxBytes = 4 * 1024

// LogForwardError emits a structured log entry for failed inference/forward requests.
// httpCtx is optional and supplies HTTP method, target, and trace_id when the error
// is surfaced through the HTTP transport. bifrostCtx carries provider/model metadata
// and upstream payloads captured before client-facing fields are stripped.
func LogForwardError(logger schemas.Logger, bifrostCtx *schemas.BifrostContext, httpCtx *fasthttp.RequestCtx, bifrostErr *schemas.BifrostError) {
	if logger == nil || bifrostErr == nil {
		return
	}

	statusCode := fasthttp.StatusInternalServerError
	if bifrostErr.StatusCode != nil {
		statusCode = *bifrostErr.StatusCode
	}

	level := schemas.LogLevelWarn
	if statusCode >= fasthttp.StatusInternalServerError {
		level = schemas.LogLevelError
	}

	logBuilder := logger.LogHTTPRequest(level, "inference forward error").
		Int("http.status_code", statusCode).
		Str("error.message", bifrostErr.GetErrorString())

	if httpCtx != nil {
		logBuilder = logBuilder.
			Str("http.method", string(httpCtx.Method())).
			Str("http.target", string(httpCtx.RequestURI()))
	}

	if bifrostErr.Type != nil && strings.TrimSpace(*bifrostErr.Type) != "" {
		logBuilder = logBuilder.Str("error.type", strings.TrimSpace(*bifrostErr.Type))
	}
	if bifrostErr.Error != nil {
		if bifrostErr.Error.Type != nil && strings.TrimSpace(*bifrostErr.Error.Type) != "" {
			logBuilder = logBuilder.Str("error.provider_type", strings.TrimSpace(*bifrostErr.Error.Type))
		}
		if bifrostErr.Error.Code != nil && strings.TrimSpace(*bifrostErr.Error.Code) != "" {
			logBuilder = logBuilder.Str("error.code", strings.TrimSpace(*bifrostErr.Error.Code))
		}
	}

	if bifrostErr.ExtraFields.Provider != "" {
		logBuilder = logBuilder.Str("provider", string(bifrostErr.ExtraFields.Provider))
	}
	if bifrostErr.ExtraFields.OriginalModelRequested != "" {
		logBuilder = logBuilder.Str("model", bifrostErr.ExtraFields.OriginalModelRequested)
	}
	if resolved := bifrostErr.ExtraFields.ResolvedModelUsed; resolved != "" &&
		resolved != bifrostErr.ExtraFields.OriginalModelRequested {
		logBuilder = logBuilder.Str("resolved_model", resolved)
	}
	if bifrostErr.ExtraFields.RequestType != "" {
		logBuilder = logBuilder.Str("request_type", string(bifrostErr.ExtraFields.RequestType))
	}

	if bifrostCtx != nil {
		if traceID, ok := bifrostCtx.Value(schemas.BifrostContextKeyTraceID).(string); ok && traceID != "" {
			logBuilder = logBuilder.Str("trace_id", traceID)
		}
		if requestID, ok := bifrostCtx.Value(schemas.BifrostContextKeyRequestID).(string); ok && requestID != "" {
			logBuilder = logBuilder.Str("request_id", requestID)
		}
	} else if httpCtx != nil {
		if traceID, ok := httpCtx.UserValue(schemas.BifrostContextKeyTraceID).(string); ok && traceID != "" {
			logBuilder = logBuilder.Str("trace_id", traceID)
		}
	}

	if rawSnippet := forwardErrorRawResponseSnippet(bifrostErr.ExtraFields.RawResponse); rawSnippet != "" {
		logBuilder = logBuilder.Str("upstream.response_snippet", rawSnippet)
	}

	logBuilder.Send()
}

func forwardErrorRawResponseSnippet(raw interface{}) string {
	if raw == nil {
		return ""
	}

	switch v := raw.(type) {
	case string:
		return truncateForwardErrorString(v, forwardErrorLogRawResponseMaxBytes)
	case []byte:
		return truncateForwardErrorString(string(v), forwardErrorLogRawResponseMaxBytes)
	case json.RawMessage:
		return truncateForwardErrorString(string(v), forwardErrorLogRawResponseMaxBytes)
	default:
		encoded, err := json.Marshal(v)
		if err != nil {
			return truncateForwardErrorString(fmt.Sprintf("%v", v), forwardErrorLogRawResponseMaxBytes)
		}
		return truncateForwardErrorString(string(encoded), forwardErrorLogRawResponseMaxBytes)
	}
}

func truncateForwardErrorString(value string, maxLen int) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) <= maxLen {
		return trimmed
	}
	return trimmed[:maxLen] + "..."
}
