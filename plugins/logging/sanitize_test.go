package logging

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
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
