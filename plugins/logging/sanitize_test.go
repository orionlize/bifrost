package logging

import (
	"strings"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/logstore"
)

func TestSanitizeChatInputHistory_DropsToolResults(t *testing.T) {
	userText := "What is the weather?"
	toolResult := `{"temp":72}`
	assistantText := "It is sunny."

	msgs := []schemas.ChatMessage{
		{
			Role: schemas.ChatMessageRoleUser,
			Content: &schemas.ChatMessageContent{
				ContentStr: &userText,
			},
		},
		{
			Role: schemas.ChatMessageRoleTool,
			Content: &schemas.ChatMessageContent{
				ContentStr: &toolResult,
			},
		},
		{
			Role: schemas.ChatMessageRoleAssistant,
			Content: &schemas.ChatMessageContent{
				ContentStr: &assistantText,
			},
		},
	}

	got := sanitizeChatInputHistory(msgs)
	if len(got) != 2 {
		t.Fatalf("len(got) = %d, want 2", len(got))
	}
	if got[0].Role != schemas.ChatMessageRoleUser {
		t.Fatalf("got[0].Role = %q, want user", got[0].Role)
	}
	if got[1].Role != schemas.ChatMessageRoleAssistant {
		t.Fatalf("got[1].Role = %q, want assistant", got[1].Role)
	}
}

func TestSanitizeChatInputHistory_DropsSystemAndDeveloper(t *testing.T) {
	systemText := "You are helpful."
	userText := "Hello"
	developerText := "Be concise."

	msgs := []schemas.ChatMessage{
		{
			Role: schemas.ChatMessageRoleSystem,
			Content: &schemas.ChatMessageContent{
				ContentStr: &systemText,
			},
		},
		{
			Role: schemas.ChatMessageRoleDeveloper,
			Content: &schemas.ChatMessageContent{
				ContentStr: &developerText,
			},
		},
		{
			Role: schemas.ChatMessageRoleUser,
			Content: &schemas.ChatMessageContent{
				ContentStr: &userText,
			},
		},
	}

	got := sanitizeChatInputHistory(msgs)
	if len(got) != 1 {
		t.Fatalf("len(got) = %d, want 1", len(got))
	}
	if got[0].Role != schemas.ChatMessageRoleUser {
		t.Fatalf("got[0].Role = %q, want user", got[0].Role)
	}
}

func TestSanitizeResponsesMessages_DropsToolResults(t *testing.T) {
	userText := "Run the search"
	toolOutput := `{"hits":1}`
	callID := "call_123"

	msgs := []schemas.ResponsesMessage{
		{
			Type: schemas.Ptr(schemas.ResponsesMessageTypeMessage),
			Role: schemas.Ptr(schemas.ResponsesInputMessageRoleUser),
			Content: &schemas.ResponsesMessageContent{
				ContentStr: &userText,
			},
		},
		{
			Type: schemas.Ptr(schemas.ResponsesMessageTypeFunctionCallOutput),
			ResponsesToolMessage: &schemas.ResponsesToolMessage{
				CallID: &callID,
				Output: &schemas.ResponsesToolMessageOutputStruct{
					ResponsesToolCallOutputStr: &toolOutput,
				},
			},
		},
	}

	got := sanitizeResponsesMessages(msgs)
	if len(got) != 1 {
		t.Fatalf("len(got) = %d, want 1", len(got))
	}
	if got[0].Role == nil || *got[0].Role != schemas.ResponsesInputMessageRoleUser {
		t.Fatalf("got[0].Role = %v, want user", got[0].Role)
	}
}

func TestSanitizeResponsesMessages_DropsReasoningAndSystem(t *testing.T) {
	userText := "What is 2+2?"
	systemText := "You are helpful."
	reasoningSummary := "thinking..."

	msgs := []schemas.ResponsesMessage{
		{
			Type: schemas.Ptr(schemas.ResponsesMessageTypeMessage),
			Role: schemas.Ptr(schemas.ResponsesInputMessageRoleSystem),
			Content: &schemas.ResponsesMessageContent{
				ContentStr: &systemText,
			},
		},
		{
			Type: schemas.Ptr(schemas.ResponsesMessageTypeMessage),
			Role: schemas.Ptr(schemas.ResponsesInputMessageRoleUser),
			Content: &schemas.ResponsesMessageContent{
				ContentStr: &userText,
			},
		},
		{
			Type: schemas.Ptr(schemas.ResponsesMessageTypeReasoning),
			ResponsesReasoning: &schemas.ResponsesReasoning{
				Summary: []schemas.ResponsesReasoningSummary{{Text: reasoningSummary}},
			},
		},
	}

	got := sanitizeResponsesMessages(msgs)
	if len(got) != 1 {
		t.Fatalf("len(got) = %d, want 1", len(got))
	}
	if got[0].Role == nil || *got[0].Role != schemas.ResponsesInputMessageRoleUser {
		t.Fatalf("got[0].Role = %v, want user", got[0].Role)
	}
}

func TestSanitizeChatOutputMessage_StripsReasoning(t *testing.T) {
	reasoning := "chain of thought"
	answer := "4"
	msg := &schemas.ChatMessage{
		Role: schemas.ChatMessageRoleAssistant,
		Content: &schemas.ChatMessageContent{
			ContentStr: &answer,
		},
		ChatAssistantMessage: &schemas.ChatAssistantMessage{
			Reasoning: &reasoning,
			ReasoningDetails: []schemas.ChatReasoningDetails{
				{Type: schemas.BifrostReasoningDetailsTypeEncrypted, Index: 0},
			},
		},
	}

	got := sanitizeChatOutputMessage(msg)
	if got.ChatAssistantMessage == nil {
		t.Fatal("expected ChatAssistantMessage to remain")
	}
	if got.ChatAssistantMessage.Reasoning != nil {
		t.Fatal("expected Reasoning to be stripped")
	}
	if len(got.ChatAssistantMessage.ReasoningDetails) != 0 {
		t.Fatal("expected ReasoningDetails to be stripped")
	}
	if got.Content == nil || got.Content.ContentStr == nil || *got.Content.ContentStr != answer {
		t.Fatalf("assistant content = %v, want %q", got.Content, answer)
	}
}

func TestSanitizeLogEntryBinaryContent_RedactsChatImageAndFile(t *testing.T) {
	b64 := strings.Repeat("A", 512)
	fileData := b64
	fileType := "application/pdf"
	entry := &logstore.Log{
		InputHistoryParsed: []schemas.ChatMessage{
			{
				Role: schemas.ChatMessageRoleUser,
				Content: &schemas.ChatMessageContent{
					ContentBlocks: []schemas.ChatContentBlock{
						{
							Type: schemas.ChatContentBlockTypeImage,
							ImageURLStruct: &schemas.ChatInputImage{
								URL: "data:image/png;base64," + b64,
							},
						},
						{
							Type: schemas.ChatContentBlockTypeFile,
							File: &schemas.ChatInputFile{
								FileData: &fileData,
								FileType: &fileType,
							},
						},
					},
				},
			},
		},
		SpeechOutputParsed: &schemas.BifrostSpeechResponse{
			Audio: []byte{1, 2, 3},
		},
		ImageGenerationOutputParsed: &schemas.BifrostImageGenerationResponse{
			Data: []schemas.ImageData{{B64JSON: b64}},
		},
	}

	sanitizeLogEntryContent(entry)

	img := entry.InputHistoryParsed[0].Content.ContentBlocks[0].ImageURLStruct
	if img == nil || img.URL != "[image/png]" {
		t.Fatalf("image url = %#v, want [image/png]", img)
	}
	file := entry.InputHistoryParsed[0].Content.ContentBlocks[1].File
	if file == nil || file.FileData == nil || *file.FileData != "[application/pdf]" {
		t.Fatalf("file data = %#v, want [application/pdf]", file)
	}
	if entry.SpeechOutputParsed != nil {
		t.Fatal("expected speech output to be cleared")
	}
	if entry.ImageGenerationOutputParsed != nil {
		t.Fatal("expected image generation output to be cleared")
	}
}

func TestSanitizeLogEntryBinaryContent_KeepsExternalImageURL(t *testing.T) {
	url := "https://example.com/image.png"
	entry := &logstore.Log{
		InputHistoryParsed: []schemas.ChatMessage{
			{
				Role: schemas.ChatMessageRoleUser,
				Content: &schemas.ChatMessageContent{
					ContentBlocks: []schemas.ChatContentBlock{
						{
							Type:           schemas.ChatContentBlockTypeImage,
							ImageURLStruct: &schemas.ChatInputImage{URL: url},
						},
					},
				},
			},
		},
	}

	sanitizeLogEntryContent(entry)

	got := entry.InputHistoryParsed[0].Content.ContentBlocks[0].ImageURLStruct.URL
	if got != url {
		t.Fatalf("url = %q, want %q", got, url)
	}
}

func TestSanitizeLogEntryBinaryContent_NilResponsesToolMessageDoesNotPanic(t *testing.T) {
	userText := "hello"
	entry := &logstore.Log{
		ResponsesInputHistoryParsed: []schemas.ResponsesMessage{
			{
				Type: schemas.Ptr(schemas.ResponsesMessageTypeMessage),
				Role: schemas.Ptr(schemas.ResponsesInputMessageRoleUser),
				Content: &schemas.ResponsesMessageContent{
					ContentStr: &userText,
				},
				ResponsesToolMessage: nil,
			},
		},
	}

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("sanitizeLogEntryContent panicked: %v", r)
		}
	}()
	sanitizeLogEntryContent(entry)
}

func TestSanitizeChatInputHistory_DropsAssistantToolOnlyMessages(t *testing.T) {
	userText := "Search the web"
	toolName := "web_search"
	msgs := []schemas.ChatMessage{
		{
			Role: schemas.ChatMessageRoleUser,
			Content: &schemas.ChatMessageContent{
				ContentStr: &userText,
			},
		},
		{
			Role: schemas.ChatMessageRoleAssistant,
			ChatAssistantMessage: &schemas.ChatAssistantMessage{
				ToolCalls: []schemas.ChatAssistantMessageToolCall{
					{
						ID:       schemas.Ptr("call_1"),
						Type:     schemas.Ptr(string(schemas.ChatToolTypeFunction)),
						Function: schemas.ChatAssistantMessageToolCallFunction{Name: schemas.Ptr(toolName)},
					},
				},
			},
		},
	}

	got := sanitizeChatInputHistory(msgs)
	if len(got) != 1 {
		t.Fatalf("len(got) = %d, want 1", len(got))
	}
	if got[0].Role != schemas.ChatMessageRoleUser {
		t.Fatalf("got[0].Role = %q, want user", got[0].Role)
	}
}

func TestSanitizeChatInputHistory_StripsToolCallsFromAssistant(t *testing.T) {
	answer := "Here you go."
	msgs := []schemas.ChatMessage{
		{
			Role: schemas.ChatMessageRoleAssistant,
			Content: &schemas.ChatMessageContent{
				ContentStr: &answer,
			},
			ChatAssistantMessage: &schemas.ChatAssistantMessage{
				ToolCalls: []schemas.ChatAssistantMessageToolCall{
					{
						ID:       schemas.Ptr("call_1"),
						Type:     schemas.Ptr(string(schemas.ChatToolTypeFunction)),
						Function: schemas.ChatAssistantMessageToolCallFunction{Name: schemas.Ptr("search")},
					},
				},
			},
		},
	}

	got := sanitizeChatInputHistory(msgs)
	if len(got) != 1 {
		t.Fatalf("len(got) = %d, want 1", len(got))
	}
	if got[0].ChatAssistantMessage == nil || len(got[0].ChatAssistantMessage.ToolCalls) != 0 {
		t.Fatal("expected tool calls to be stripped from assistant message")
	}
}

func TestSanitizeResponsesMessages_DropsFunctionCalls(t *testing.T) {
	userText := "Call a tool"
	msgs := []schemas.ResponsesMessage{
		{
			Type: schemas.Ptr(schemas.ResponsesMessageTypeMessage),
			Role: schemas.Ptr(schemas.ResponsesInputMessageRoleUser),
			Content: &schemas.ResponsesMessageContent{
				ContentStr: &userText,
			},
		},
		{
			Type: schemas.Ptr(schemas.ResponsesMessageTypeFunctionCall),
		},
	}

	got := sanitizeResponsesMessages(msgs)
	if len(got) != 1 {
		t.Fatalf("len(got) = %d, want 1", len(got))
	}
}

func TestSanitizeLogEntryNonMessageContent_ClearsAuxiliaryFields(t *testing.T) {
	entry := &logstore.Log{
		RawRequest:              `{"model":"gpt-4o"}`,
		RawResponse:             `{"id":"resp_1"}`,
		PluginLogs:              `{"telemetry":[{"message":"metric"}]}`,
		RoutingEngineLogs:       "[1] [governance] - selected key",
		ToolsParsed:             []schemas.ChatTool{{Type: schemas.ChatToolTypeFunction}},
		PassthroughRequestBody:  `{"foo":1}`,
		PassthroughResponseBody: `{"bar":2}`,
		ParamsParsed: &schemas.ChatParameters{
			Temperature: schemas.Ptr(0.7),
		},
		EmbeddingOutput: `[{"embedding":[0.1]}]`,
	}

	sanitizeLogEntryContent(entry)

	if entry.RawRequest != "" || entry.RawResponse != "" {
		t.Fatal("expected raw request/response to be cleared")
	}
	if entry.PluginLogs != "" || entry.RoutingEngineLogs != "" {
		t.Fatal("expected plugin and routing logs to be cleared")
	}
	if entry.ParamsParsed != nil || len(entry.ToolsParsed) != 0 {
		t.Fatal("expected params and tools to be cleared")
	}
	if entry.PassthroughRequestBody != "" || entry.PassthroughResponseBody != "" {
		t.Fatal("expected passthrough bodies to be cleared")
	}
	if entry.EmbeddingOutput != "" {
		t.Fatal("expected embedding output to be cleared")
	}
}
