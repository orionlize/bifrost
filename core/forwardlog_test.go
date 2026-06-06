package bifrost

import (
	"strings"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/valyala/fasthttp"
)

type forwardErrorLogCapture struct {
	level     schemas.LogLevel
	msg       string
	strFields map[string]string
	intFields map[string]int
}

func (c *forwardErrorLogCapture) Debug(string, ...any) {}
func (c *forwardErrorLogCapture) Info(string, ...any)  {}
func (c *forwardErrorLogCapture) Warn(string, ...any)  {}
func (c *forwardErrorLogCapture) Error(string, ...any) {}
func (c *forwardErrorLogCapture) Fatal(string, ...any) {}
func (c *forwardErrorLogCapture) SetLevel(schemas.LogLevel)              {}
func (c *forwardErrorLogCapture) SetOutputType(schemas.LoggerOutputType) {}

func (c *forwardErrorLogCapture) LogHTTPRequest(level schemas.LogLevel, msg string) schemas.LogEventBuilder {
	c.level = level
	c.msg = msg
	c.strFields = make(map[string]string)
	c.intFields = make(map[string]int)
	return &forwardErrorLogCaptureBuilder{capture: c}
}

type forwardErrorLogCaptureBuilder struct {
	capture *forwardErrorLogCapture
}

func (b *forwardErrorLogCaptureBuilder) Str(key, val string) schemas.LogEventBuilder {
	b.capture.strFields[key] = val
	return b
}

func (b *forwardErrorLogCaptureBuilder) Int(key string, val int) schemas.LogEventBuilder {
	b.capture.intFields[key] = val
	return b
}

func (b *forwardErrorLogCaptureBuilder) Int64(string, int64) schemas.LogEventBuilder { return b }
func (b *forwardErrorLogCaptureBuilder) Send()                                         {}

func TestLogForwardError_IncludesProviderMetadataAndUpstreamSnippet(t *testing.T) {
	capture := &forwardErrorLogCapture{}
	statusCode := 502
	errType := "server_error"
	bifrostErr := &schemas.BifrostError{
		StatusCode: &statusCode,
		Type:       &errType,
		Error: &schemas.ErrorField{
			Message: "provider server error (502)",
		},
		ExtraFields: schemas.BifrostErrorExtraFields{
			Provider:               schemas.OpenAI,
			OriginalModelRequested: "gpt-4o-mini",
			RequestType:            schemas.ChatCompletionRequest,
			RawResponse:            `{"error":{"message":"upstream unavailable"}}`,
		},
	}

	bifrostCtx := schemas.NewBifrostContext(nil, schemas.NoDeadline)
	bifrostCtx.SetValue(schemas.BifrostContextKeyTraceID, "trace-123")
	bifrostCtx.SetValue(schemas.BifrostContextKeyRequestID, "req-456")

	httpCtx := &fasthttp.RequestCtx{}
	httpCtx.Request.Header.SetMethod("POST")
	httpCtx.Request.SetRequestURI("/v1/chat/completions")

	LogForwardError(capture, bifrostCtx, httpCtx, bifrostErr)

	if capture.msg != "inference forward error" {
		t.Fatalf("expected inference forward error message, got %q", capture.msg)
	}
	if capture.level != schemas.LogLevelError {
		t.Fatalf("expected error level for 502, got %v", capture.level)
	}
	if capture.intFields["http.status_code"] != 502 {
		t.Fatalf("expected status 502, got %d", capture.intFields["http.status_code"])
	}
	if capture.strFields["provider"] != string(schemas.OpenAI) {
		t.Fatalf("expected provider openai, got %q", capture.strFields["provider"])
	}
	if capture.strFields["model"] != "gpt-4o-mini" {
		t.Fatalf("expected model gpt-4o-mini, got %q", capture.strFields["model"])
	}
	if capture.strFields["trace_id"] != "trace-123" {
		t.Fatalf("expected trace_id trace-123, got %q", capture.strFields["trace_id"])
	}
	if capture.strFields["request_id"] != "req-456" {
		t.Fatalf("expected request_id req-456, got %q", capture.strFields["request_id"])
	}
	if capture.strFields["upstream.response_snippet"] == "" {
		t.Fatalf("expected upstream response snippet to be logged")
	}
}

func TestForwardErrorRawResponseSnippet_TruncatesLongBodies(t *testing.T) {
	longBody := strings.Repeat("a", forwardErrorLogRawResponseMaxBytes+10)
	snippet := forwardErrorRawResponseSnippet(longBody)
	if len(snippet) != forwardErrorLogRawResponseMaxBytes+3 {
		t.Fatalf("expected truncated snippet length %d, got %d", forwardErrorLogRawResponseMaxBytes+3, len(snippet))
	}
	if !strings.HasSuffix(snippet, "...") {
		t.Fatalf("expected truncated snippet suffix")
	}
}
