package mimo

import (
	"strings"
	"testing"

	schemas "github.com/maximhq/bifrost/core/schemas"
)

func strPtr(s string) *string { return &s }

// marshalContent renders a message's content the way it is sent on the wire.
func marshalContent(t *testing.T, msg schemas.ChatMessage) string {
	t.Helper()
	if msg.Content == nil {
		return "null"
	}
	b, err := msg.Content.MarshalJSON()
	if err != nil {
		t.Fatalf("marshal content: %v", err)
	}
	return string(b)
}

func TestIsMiMoVisionCapableModel(t *testing.T) {
	tests := []struct {
		model string
		want  bool
	}{
		{"mimo-v2.5-pro", false},
		{"mimo-v2.5", true},
		{"mimo-v2-omni", true},
		{"mimo-v2.5-pro-preview", false},
	}
	for _, tc := range tests {
		if got := isMiMoVisionCapableModel(tc.model); got != tc.want {
			t.Fatalf("isMiMoVisionCapableModel(%q) = %v, want %v", tc.model, got, tc.want)
		}
	}
}

func TestValidateMiMoVisionSupport_RejectsProWithImage(t *testing.T) {
	req := &schemas.BifrostChatRequest{
		Provider: schemas.MiMo,
		Model:    "mimo-v2.5-pro",
		Input: []schemas.ChatMessage{
			{
				Role: schemas.ChatMessageRoleUser,
				Content: &schemas.ChatMessageContent{
					ContentBlocks: []schemas.ChatContentBlock{
						{
							Type:           schemas.ChatContentBlockTypeImage,
							ImageURLStruct: &schemas.ChatInputImage{URL: "https://example.com/a.png"},
						},
					},
				},
			},
		},
	}
	if err := validateMiMoVisionSupport(req); err == nil {
		t.Fatal("expected vision validation error for mimo-v2.5-pro with image")
	}
}

func TestValidateMiMoVisionSupport_AllowsV25WithImage(t *testing.T) {
	req := &schemas.BifrostChatRequest{
		Provider: schemas.MiMo,
		Model:    "mimo-v2.5",
		Input: []schemas.ChatMessage{
			{
				Role: schemas.ChatMessageRoleUser,
				Content: &schemas.ChatMessageContent{
					ContentBlocks: []schemas.ChatContentBlock{
						{
							Type:           schemas.ChatContentBlockTypeImage,
							ImageURLStruct: &schemas.ChatInputImage{URL: "https://example.com/a.png"},
						},
					},
				},
			},
		},
	}
	if err := validateMiMoVisionSupport(req); err != nil {
		t.Fatalf("unexpected vision validation error: %v", err)
	}
}

func TestNormalizeMiMo_ImageOnlyMessageGetsTextPart(t *testing.T) {
	// Simulate a Codex Responses request with an image-only user message.
	req := &schemas.BifrostResponsesRequest{
		Provider: schemas.MiMo,
		Model:    "mimo-v2.5",
		Input: []schemas.ResponsesMessage{
			{
				Role: ptrRole(schemas.ResponsesInputMessageRoleUser),
				Content: &schemas.ResponsesMessageContent{
					ContentBlocks: []schemas.ResponsesMessageContentBlock{
						{
							Type:                                   schemas.ResponsesInputMessageContentBlockTypeImage,
							ResponsesInputMessageContentBlockImage: &schemas.ResponsesInputMessageContentBlockImage{ImageURL: strPtr("data:image/png;base64,AAAA")},
						},
					},
				},
			},
		},
	}

	chat := req.ToChatRequest()
	normalizeMiMoChatRequest(chat)

	if len(chat.Input) != 1 {
		t.Fatalf("expected 1 message, got %d", len(chat.Input))
	}
	out := marshalContent(t, chat.Input[0])
	if !strings.Contains(out, `"type":"text"`) || !strings.Contains(out, `"text"`) {
		t.Fatalf("image-only message must include a text part, got: %s", out)
	}
	if !strings.Contains(out, `"image_url"`) {
		t.Fatalf("image part must be preserved, got: %s", out)
	}
}

func TestNormalizeMiMo_AllTextArrayCollapsesToString(t *testing.T) {
	req := &schemas.BifrostResponsesRequest{
		Provider: schemas.MiMo,
		Model:    "mimo-v2.5",
		Input: []schemas.ResponsesMessage{
			{
				Role: ptrRole(schemas.ResponsesInputMessageRoleUser),
				Content: &schemas.ResponsesMessageContent{
					ContentBlocks: []schemas.ResponsesMessageContentBlock{
						{Type: schemas.ResponsesInputMessageContentBlockTypeText, Text: strPtr("hello")},
						{Type: schemas.ResponsesInputMessageContentBlockTypeText, Text: strPtr("world")},
					},
				},
			},
		},
	}

	chat := req.ToChatRequest()
	normalizeMiMoChatRequest(chat)

	c := chat.Input[0].Content
	if c == nil || c.ContentStr == nil {
		t.Fatalf("all-text content should collapse to a string, got blocks: %#v", c)
	}
	if c.ContentBlocks != nil {
		t.Fatalf("collapsed content must not retain blocks")
	}
}

func TestNormalizeMiMo_NoBareTextPart(t *testing.T) {
	// A text block with nil text + an image must not yield a bare {"type":"text"}.
	req := &schemas.BifrostResponsesRequest{
		Provider: schemas.MiMo,
		Model:    "mimo-v2.5",
		Input: []schemas.ResponsesMessage{
			{
				Role: ptrRole(schemas.ResponsesInputMessageRoleUser),
				Content: &schemas.ResponsesMessageContent{
					ContentBlocks: []schemas.ResponsesMessageContentBlock{
						{Type: schemas.ResponsesInputMessageContentBlockTypeText}, // nil text
						{
							Type:                                   schemas.ResponsesInputMessageContentBlockTypeImage,
							ResponsesInputMessageContentBlockImage: &schemas.ResponsesInputMessageContentBlockImage{ImageURL: strPtr("data:image/png;base64,AAAA")},
						},
					},
				},
			},
		},
	}

	chat := req.ToChatRequest()
	normalizeMiMoChatRequest(chat)

	out := marshalContent(t, chat.Input[0])
	if strings.Contains(out, `{"type":"text"}`) {
		t.Fatalf("must not emit a bare text part without text, got: %s", out)
	}
}

func TestNormalizeMiMo_ForcesParallelToolCalls(t *testing.T) {
	disabled := false
	req := &schemas.BifrostChatRequest{
		Provider: schemas.MiMo,
		Model:    "mimo-v2.5",
		Input: []schemas.ChatMessage{
			{Role: schemas.ChatMessageRoleUser, Content: &schemas.ChatMessageContent{ContentStr: strPtr("hi")}},
		},
		Params: &schemas.ChatParameters{
			ParallelToolCalls: &disabled,
			Tools: []schemas.ChatTool{
				{Type: schemas.ChatToolTypeFunction, Function: &schemas.ChatToolFunction{Name: "shell"}},
			},
		},
	}

	normalizeMiMoChatRequest(req)

	if req.Params.ParallelToolCalls == nil || !*req.Params.ParallelToolCalls {
		t.Fatalf("expected parallel_tool_calls forced true, got %v", req.Params.ParallelToolCalls)
	}
}

func TestNormalizeMiMo_NoToolsLeavesParamsUntouched(t *testing.T) {
	req := &schemas.BifrostChatRequest{
		Provider: schemas.MiMo,
		Model:    "mimo-v2.5",
		Input: []schemas.ChatMessage{
			{Role: schemas.ChatMessageRoleUser, Content: &schemas.ChatMessageContent{ContentStr: strPtr("hi")}},
		},
	}

	normalizeMiMoChatRequest(req)

	if req.Params != nil {
		t.Fatalf("expected params to remain nil when no tools present")
	}
}

func TestNormalizeMiMo_InjectsToolNudgeAfterSystem(t *testing.T) {
	req := &schemas.BifrostChatRequest{
		Provider: schemas.MiMo,
		Model:    "mimo-v2.5",
		Input: []schemas.ChatMessage{
			{Role: schemas.ChatMessageRoleSystem, Content: &schemas.ChatMessageContent{ContentStr: strPtr("codex system prompt")}},
			{Role: schemas.ChatMessageRoleUser, Content: &schemas.ChatMessageContent{ContentStr: strPtr("open brave")}},
		},
		Params: &schemas.ChatParameters{
			Tools: []schemas.ChatTool{
				{Type: schemas.ChatToolTypeFunction, Function: &schemas.ChatToolFunction{Name: "browser"}},
			},
		},
	}

	normalizeMiMoChatRequest(req)

	if len(req.Input) != 3 {
		t.Fatalf("expected nudge inserted, got %d messages", len(req.Input))
	}
	// Original system prompt stays first; nudge sits right after it; user last.
	if req.Input[0].Role != schemas.ChatMessageRoleSystem || req.Input[0].Content.ContentStr == nil || *req.Input[0].Content.ContentStr != "codex system prompt" {
		t.Fatalf("original system prompt must remain first: %#v", req.Input[0])
	}
	if req.Input[1].Role != schemas.ChatMessageRoleSystem || req.Input[1].Content.ContentStr == nil || !strings.Contains(*req.Input[1].Content.ContentStr, "TOOL POLICY") {
		t.Fatalf("nudge must be inserted after leading system messages: %#v", req.Input[1])
	}
	if req.Input[2].Role != schemas.ChatMessageRoleUser {
		t.Fatalf("user message must remain last: %#v", req.Input[2])
	}
}

func TestNormalizeMiMo_NoNudgeWithoutTools(t *testing.T) {
	req := &schemas.BifrostChatRequest{
		Provider: schemas.MiMo,
		Model:    "mimo-v2.5",
		Input: []schemas.ChatMessage{
			{Role: schemas.ChatMessageRoleUser, Content: &schemas.ChatMessageContent{ContentStr: strPtr("hi")}},
		},
	}

	normalizeMiMoChatRequest(req)

	if len(req.Input) != 1 {
		t.Fatalf("expected no nudge without tools, got %d messages", len(req.Input))
	}
}

func ptrRole(r schemas.ResponsesMessageRoleType) *schemas.ResponsesMessageRoleType {
	return &r
}
