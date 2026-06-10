package logging

import (
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/logstore"
)

func isSystemChatRole(role schemas.ChatMessageRole) bool {
	return role == schemas.ChatMessageRoleSystem || role == schemas.ChatMessageRoleDeveloper
}

func isToolChatRole(role schemas.ChatMessageRole) bool {
	return role == schemas.ChatMessageRoleTool
}

func isResponsesToolMessage(msg schemas.ResponsesMessage) bool {
	if msg.Type == nil {
		return false
	}
	switch *msg.Type {
	case schemas.ResponsesMessageTypeFunctionCall,
		schemas.ResponsesMessageTypeFunctionCallOutput,
		schemas.ResponsesMessageTypeCustomToolCall,
		schemas.ResponsesMessageTypeCustomToolCallOutput,
		schemas.ResponsesMessageTypeLocalShellCall,
		schemas.ResponsesMessageTypeLocalShellCallOutput,
		schemas.ResponsesMessageTypeComputerCall,
		schemas.ResponsesMessageTypeComputerCallOutput,
		schemas.ResponsesMessageTypeMCPCall,
		schemas.ResponsesMessageTypeMCPListTools,
		schemas.ResponsesMessageTypeMCPApprovalRequest,
		schemas.ResponsesMessageTypeMCPApprovalResponses,
		schemas.ResponsesMessageTypeFileSearchCall,
		schemas.ResponsesMessageTypeWebSearchCall,
		schemas.ResponsesMessageTypeWebFetchCall,
		schemas.ResponsesMessageTypeCodeInterpreterCall,
		schemas.ResponsesMessageTypeImageGenerationCall,
		schemas.ResponsesMessageTypeToolSearchCall,
		schemas.ResponsesMessageTypeReasoning,
		schemas.ResponsesMessageTypeItemReference:
		return true
	default:
		return false
	}
}

func isResponsesConversationMessage(msg schemas.ResponsesMessage) bool {
	if isResponsesToolMessage(msg) {
		return false
	}
	if msg.Role != nil {
		switch *msg.Role {
		case schemas.ResponsesInputMessageRoleSystem, schemas.ResponsesInputMessageRoleDeveloper:
			return false
		case schemas.ResponsesInputMessageRoleUser, schemas.ResponsesInputMessageRoleAssistant:
			return true
		}
	}
	if msg.Type == nil {
		return true
	}
	return *msg.Type == schemas.ResponsesMessageTypeMessage || *msg.Type == schemas.ResponsesMessageTypeRefusal
}

func chatMessageHasVisibleContent(msg schemas.ChatMessage) bool {
	if msg.Role == schemas.ChatMessageRoleUser {
		return true
	}
	if chatMessageContentPresent(msg) {
		return true
	}
	if msg.ChatAssistantMessage != nil && msg.ChatAssistantMessage.Refusal != nil && strings.TrimSpace(*msg.ChatAssistantMessage.Refusal) != "" {
		return true
	}
	return false
}

func chatMessageContentPresent(msg schemas.ChatMessage) bool {
	if msg.Content == nil {
		return false
	}
	if msg.Content.ContentStr != nil && strings.TrimSpace(*msg.Content.ContentStr) != "" {
		return true
	}
	for _, block := range msg.Content.ContentBlocks {
		switch block.Type {
		case schemas.ChatContentBlockTypeText:
			if block.Text != nil && strings.TrimSpace(*block.Text) != "" {
				return true
			}
		case schemas.ChatContentBlockTypeImage:
			if block.ImageURLStruct != nil && strings.TrimSpace(block.ImageURLStruct.URL) != "" {
				return true
			}
		case schemas.ChatContentBlockTypeInputAudio:
			if block.InputAudio != nil {
				return true
			}
		}
	}
	return false
}

func stripChatMessageToolCalls(msg schemas.ChatMessage) schemas.ChatMessage {
	if msg.ChatAssistantMessage != nil {
		assistant := *msg.ChatAssistantMessage
		assistant.ToolCalls = nil
		msg.ChatAssistantMessage = &assistant
	}
	return msg
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
		if msg.Role == schemas.ChatMessageRoleAssistant && !chatMessageHasVisibleContent(msg) {
			continue
		}
		out = append(out, stripChatMessageToolCalls(msg))
	}
	return out
}

func sanitizeResponsesMessages(msgs []schemas.ResponsesMessage) []schemas.ResponsesMessage {
	if len(msgs) == 0 {
		return msgs
	}
	out := make([]schemas.ResponsesMessage, 0, len(msgs))
	for _, msg := range msgs {
		if !isResponsesConversationMessage(msg) {
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
	sanitized := stripChatMessageToolCalls(*msg)
	if sanitized.ChatAssistantMessage != nil {
		assistant := *sanitized.ChatAssistantMessage
		assistant.Reasoning = nil
		assistant.ReasoningDetails = nil
		sanitized.ChatAssistantMessage = &assistant
	}
	return &sanitized
}

func sanitizeLogEntryNonMessageContent(entry *logstore.Log) {
	entry.RawRequest = ""
	entry.RawResponse = ""
	entry.PassthroughRequestBody = ""
	entry.PassthroughResponseBody = ""
	entry.PluginLogs = ""
	entry.RoutingEngineLogs = ""
	entry.Tools = ""
	entry.ToolsParsed = nil
	entry.ToolCalls = ""
	entry.ToolCallsParsed = nil
	entry.Params = ""
	entry.ParamsParsed = nil

	entry.SpeechInput = ""
	entry.SpeechInputParsed = nil
	entry.SpeechOutput = ""
	entry.SpeechOutputParsed = nil
	entry.TranscriptionInput = ""
	entry.TranscriptionInputParsed = nil
	entry.TranscriptionOutput = ""
	entry.TranscriptionOutputParsed = nil
	entry.OCRInput = ""
	entry.OCRInputParsed = nil
	entry.OCROutput = ""
	entry.OCROutputParsed = nil
	entry.ImageGenerationInput = ""
	entry.ImageGenerationInputParsed = nil
	entry.ImageEditInput = ""
	entry.ImageEditInputParsed = nil
	entry.ImageVariationInput = ""
	entry.ImageVariationInputParsed = nil
	entry.ImageGenerationOutput = ""
	entry.ImageGenerationOutputParsed = nil
	entry.VideoGenerationInput = ""
	entry.VideoGenerationInputParsed = nil
	entry.VideoGenerationOutput = ""
	entry.VideoGenerationOutputParsed = nil
	entry.VideoRetrieveOutput = ""
	entry.VideoRetrieveOutputParsed = nil
	entry.VideoDownloadOutput = ""
	entry.VideoDownloadOutputParsed = nil
	entry.VideoListOutput = ""
	entry.VideoListOutputParsed = nil
	entry.VideoDeleteOutput = ""
	entry.VideoDeleteOutputParsed = nil
	entry.EmbeddingOutput = ""
	entry.EmbeddingOutputParsed = nil
	entry.RerankOutput = ""
	entry.RerankOutputParsed = nil
	entry.ListModelsOutput = ""
	entry.ListModelsOutputParsed = nil
}

// sanitizeLogEntryContent keeps only user/assistant conversation content and error
// details in log records, stripping system prompts, tool I/O, reasoning, raw
// payloads, plugin/routing logs, and modality-specific inputs/outputs.
func sanitizeLogEntryContent(entry *logstore.Log) {
	if entry == nil {
		return
	}
	entry.InputHistoryParsed = sanitizeChatInputHistory(entry.InputHistoryParsed)
	entry.ResponsesInputHistoryParsed = sanitizeResponsesMessages(entry.ResponsesInputHistoryParsed)
	entry.ResponsesOutputParsed = sanitizeResponsesMessages(entry.ResponsesOutputParsed)
	entry.OutputMessageParsed = sanitizeChatOutputMessage(entry.OutputMessageParsed)
	sanitizeLogEntryBinaryContent(entry)
	sanitizeLogEntryNonMessageContent(entry)
}
