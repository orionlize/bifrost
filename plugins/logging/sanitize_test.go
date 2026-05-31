package logging

import (
	"strings"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/logstore"
)

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
	if len(entry.SpeechOutputParsed.Audio) != 0 {
		t.Fatal("expected speech audio to be stripped")
	}
	if entry.ImageGenerationOutputParsed.Data[0].B64JSON != "[image]" {
		t.Fatalf("b64_json = %q, want [image]", entry.ImageGenerationOutputParsed.Data[0].B64JSON)
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
