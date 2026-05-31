package logstore

import (
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

const (
	MetadataKeyInputHistoryDelta               = "input_history_delta"
	MetadataKeyConversationInputCount          = "conversation_input_count"
	MetadataKeyConversationResponsesInputCount = "conversation_responses_input_count"
)

// SupportsIncrementalInput returns true when the log object type stores multi-turn
// conversation input that benefits from delta persistence.
func SupportsIncrementalInput(object string) bool {
	switch object {
	case string(schemas.ChatCompletionRequest),
		string(schemas.ChatCompletionStreamRequest),
		string(schemas.ResponsesRequest),
		string(schemas.ResponsesStreamRequest),
		string(schemas.TextCompletionRequest),
		string(schemas.TextCompletionStreamRequest),
		"realtime.turn":
		return true
	default:
		return false
	}
}

func metadataInt(metadata map[string]interface{}, key string) int {
	if metadata == nil {
		return 0
	}
	value, ok := metadata[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float32:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func metadataBool(metadata map[string]interface{}, key string) bool {
	if metadata == nil {
		return false
	}
	value, ok := metadata[key]
	if !ok || value == nil {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return typed == "true" || typed == "1"
	default:
		return false
	}
}

func setIncrementalMetadata(entry *Log, chatCount, responsesCount int) {
	if entry.MetadataParsed == nil {
		entry.MetadataParsed = make(map[string]interface{})
	}
	entry.MetadataParsed[MetadataKeyInputHistoryDelta] = true
	if chatCount > 0 {
		entry.MetadataParsed[MetadataKeyConversationInputCount] = chatCount
	} else {
		delete(entry.MetadataParsed, MetadataKeyConversationInputCount)
	}
	if responsesCount > 0 {
		entry.MetadataParsed[MetadataKeyConversationResponsesInputCount] = responsesCount
	} else {
		delete(entry.MetadataParsed, MetadataKeyConversationResponsesInputCount)
	}
}

// SessionIDForLog returns the session identifier used to group incremental input deltas.
func SessionIDForLog(entry *Log) string {
	if entry == nil || entry.ParentRequestID == nil {
		return ""
	}
	return strings.TrimSpace(*entry.ParentRequestID)
}

// NeedsInputHydration reports whether stored input fields are delta-encoded.
func NeedsInputHydration(entry *Log) bool {
	if entry == nil {
		return false
	}
	return metadataBool(entry.MetadataParsed, MetadataKeyInputHistoryDelta)
}

// ApplyIncrementalInputStorage replaces full sanitized input with delta slices and
// records cumulative counts in metadata. contentSummary should be built before calling.
func ApplyIncrementalInputStorage(entry *Log, previousChatCount, previousResponsesCount int) {
	if entry == nil || !SupportsIncrementalInput(entry.Object) {
		return
	}

	var chatCumulative, respCumulative int

	if len(entry.InputHistoryParsed) > 0 {
		full := entry.InputHistoryParsed
		chatCumulative = len(full)
		start := previousChatCount
		if start > chatCumulative {
			start = 0
		}
		entry.InputHistoryParsed = append([]schemas.ChatMessage(nil), full[start:]...)
	}

	if len(entry.ResponsesInputHistoryParsed) > 0 {
		full := entry.ResponsesInputHistoryParsed
		respCumulative = len(full)
		start := previousResponsesCount
		if start > respCumulative {
			start = 0
		}
		entry.ResponsesInputHistoryParsed = append([]schemas.ResponsesMessage(nil), full[start:]...)
	}

	if chatCumulative == 0 && respCumulative == 0 {
		return
	}
	setIncrementalMetadata(entry, chatCumulative, respCumulative)
}

// MergeChatInputHistory concatenates delta-encoded chat inputs from session logs in order.
func MergeChatInputHistory(logs []*Log) []schemas.ChatMessage {
	merged := make([]schemas.ChatMessage, 0)
	for _, log := range logs {
		if log == nil || len(log.InputHistoryParsed) == 0 {
			continue
		}
		if metadataBool(log.MetadataParsed, MetadataKeyInputHistoryDelta) {
			merged = append(merged, log.InputHistoryParsed...)
			continue
		}
		merged = log.InputHistoryParsed
	}
	return merged
}

// MergeResponsesInputHistory concatenates delta-encoded responses inputs from session logs in order.
func MergeResponsesInputHistory(logs []*Log) []schemas.ResponsesMessage {
	merged := make([]schemas.ResponsesMessage, 0)
	for _, log := range logs {
		if log == nil || len(log.ResponsesInputHistoryParsed) == 0 {
			continue
		}
		if metadataBool(log.MetadataParsed, MetadataKeyInputHistoryDelta) {
			merged = append(merged, log.ResponsesInputHistoryParsed...)
			continue
		}
		merged = log.ResponsesInputHistoryParsed
	}
	return merged
}

// HydrateLogInputHistory expands delta-encoded input fields on entry using prior session logs.
func HydrateLogInputHistory(entry *Log, sessionLogs []*Log) {
	if entry == nil || !NeedsInputHydration(entry) {
		return
	}
	if len(sessionLogs) == 0 {
		return
	}

	if len(entry.InputHistoryParsed) > 0 {
		prefix := MergeChatInputHistory(sessionLogs)
		if len(prefix) > 0 {
			entry.InputHistoryParsed = append(prefix, entry.InputHistoryParsed...)
		}
	}
	if len(entry.ResponsesInputHistoryParsed) > 0 {
		prefix := MergeResponsesInputHistory(sessionLogs)
		if len(prefix) > 0 {
			entry.ResponsesInputHistoryParsed = append(prefix, entry.ResponsesInputHistoryParsed...)
		}
	}
}

// LatestConversationCountsFromMetadata reads cumulative input counts from a log metadata map.
func LatestConversationCountsFromMetadata(metadata map[string]interface{}) (chatCount, responsesCount int) {
	return metadataInt(metadata, MetadataKeyConversationInputCount),
		metadataInt(metadata, MetadataKeyConversationResponsesInputCount)
}

// SessionAnchor describes the upper bound (inclusive) for session log hydration queries.
type SessionAnchor struct {
	SessionID string
	Timestamp time.Time
	LogID     string
}
