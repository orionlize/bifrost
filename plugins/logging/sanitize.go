package logging

import (
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/logstore"
)

func isSystemChatRole(role schemas.ChatMessageRole) bool {
	return role == schemas.ChatMessageRoleSystem || role == schemas.ChatMessageRoleDeveloper
}

func isToolChatRole(role schemas.ChatMessageRole) bool {
	return role == schemas.ChatMessageRoleTool
}

func isResponsesToolResultMessage(msg schemas.ResponsesMessage) bool {
	if msg.Type == nil {
		return false
	}
	switch *msg.Type {
	case schemas.ResponsesMessageTypeFunctionCallOutput,
		schemas.ResponsesMessageTypeCustomToolCallOutput,
		schemas.ResponsesMessageTypeLocalShellCallOutput,
		schemas.ResponsesMessageTypeComputerCallOutput,
		schemas.ResponsesMessageTypeMCPApprovalResponses:
		return true
	default:
		return false
	}
}

func isResponsesMessageExcludedFromLogs(msg schemas.ResponsesMessage) bool {
	if msg.Type != nil && *msg.Type == schemas.ResponsesMessageTypeReasoning {
		return true
	}
	if msg.Role != nil {
		switch *msg.Role {
		case schemas.ResponsesInputMessageRoleSystem, schemas.ResponsesInputMessageRoleDeveloper:
			return true
		}
	}
	return false
}

func sanitizeChatInputHistory(msgs []schemas.ChatMessage) []schemas.ChatMessage {
	if len(msgs) == 0 {
		return msgs
	}
	out := make([]schemas.ChatMessage, 0, len(msgs))
	for _, msg := range msgs {
		if isSystemChatRole(msg.Role) || isToolChatRole(msg.Role) {
			continue
		}
		out = append(out, msg)
	}
	return out
}

func sanitizeResponsesMessages(msgs []schemas.ResponsesMessage) []schemas.ResponsesMessage {
	if len(msgs) == 0 {
		return msgs
	}
	out := make([]schemas.ResponsesMessage, 0, len(msgs))
	for _, msg := range msgs {
		if isResponsesMessageExcludedFromLogs(msg) || isResponsesToolResultMessage(msg) {
			continue
		}
		msg.ResponsesReasoning = nil
		out = append(out, msg)
	}
	return out
}

func sanitizeChatOutputMessage(msg *schemas.ChatMessage) *schemas.ChatMessage {
	if msg == nil {
		return nil
	}
	sanitized := *msg
	if sanitized.ChatAssistantMessage != nil {
		assistant := *sanitized.ChatAssistantMessage
		assistant.Reasoning = nil
		assistant.ReasoningDetails = nil
		sanitized.ChatAssistantMessage = &assistant
	}
	return &sanitized
}

// sanitizeLogEntryContent removes system/developer input, tool-call results,
// reasoning output, and inline binary payloads from log entries before persistence.
func sanitizeLogEntryContent(entry *logstore.Log) {
	if entry == nil {
		return
	}
	entry.InputHistoryParsed = sanitizeChatInputHistory(entry.InputHistoryParsed)
	entry.ResponsesInputHistoryParsed = sanitizeResponsesMessages(entry.ResponsesInputHistoryParsed)
	entry.ResponsesOutputParsed = sanitizeResponsesMessages(entry.ResponsesOutputParsed)
	entry.OutputMessageParsed = sanitizeChatOutputMessage(entry.OutputMessageParsed)
	sanitizeLogEntryBinaryContent(entry)
}
