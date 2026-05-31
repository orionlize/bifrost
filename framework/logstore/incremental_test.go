package logstore

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

func TestApplyIncrementalInputStorage_Chat(t *testing.T) {
	entry := &Log{
		Object: string(schemas.ChatCompletionRequest),
		InputHistoryParsed: []schemas.ChatMessage{
			{Role: schemas.ChatMessageRoleUser, Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr("u1")}},
			{Role: schemas.ChatMessageRoleAssistant, Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr("a1")}},
			{Role: schemas.ChatMessageRoleUser, Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr("u2")}},
		},
	}

	ApplyIncrementalInputStorage(entry, 1, 0)

	if len(entry.InputHistoryParsed) != 2 {
		t.Fatalf("expected 2 delta messages, got %d", len(entry.InputHistoryParsed))
	}
	if !metadataBool(entry.MetadataParsed, MetadataKeyInputHistoryDelta) {
		t.Fatal("expected delta metadata flag")
	}
	if got := metadataInt(entry.MetadataParsed, MetadataKeyConversationInputCount); got != 3 {
		t.Fatalf("conversation_input_count = %d, want 3", got)
	}
}

func TestHydrateLogInputHistory(t *testing.T) {
	sessionID := "session-1"
	makeLog := func(id string, delta []schemas.ChatMessage, count int) *Log {
		return &Log{
			ID:                 id,
			ParentRequestID:    &sessionID,
			InputHistoryParsed: delta,
			MetadataParsed: map[string]interface{}{
				MetadataKeyInputHistoryDelta:      true,
				MetadataKeyConversationInputCount: count,
			},
		}
	}

	log1 := makeLog("log-1", []schemas.ChatMessage{
		{Role: schemas.ChatMessageRoleUser, Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr("u1")}},
	}, 1)

	target := &Log{
		ID:              "log-2",
		ParentRequestID: &sessionID,
		InputHistoryParsed: []schemas.ChatMessage{
			{Role: schemas.ChatMessageRoleAssistant, Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr("a1")}},
			{Role: schemas.ChatMessageRoleUser, Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr("u2")}},
		},
		MetadataParsed: map[string]interface{}{
			MetadataKeyInputHistoryDelta:      true,
			MetadataKeyConversationInputCount: 3,
		},
	}

	HydrateLogInputHistory(target, []*Log{log1})

	if len(target.InputHistoryParsed) != 3 {
		t.Fatalf("expected hydrated history length 3, got %d", len(target.InputHistoryParsed))
	}
	if target.InputHistoryParsed[0].Role != schemas.ChatMessageRoleUser {
		t.Fatalf("expected first hydrated message to be user, got %q", target.InputHistoryParsed[0].Role)
	}
}
