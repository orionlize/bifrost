package mimo

import (
	"strings"

	schemas "github.com/maximhq/bifrost/core/schemas"
)

// placeholderText is injected when a message carries non-text content (e.g. an
// image) but no usable text part. MiMo's API rejects such messages with
// 400 "Param Incorrect: `text` is not set", so a single space is used as a
// minimal valid text part (same workaround used by mimo2codex / codex-bridge).
const placeholderText = " "

// normalizeMiMoChatRequest rewrites message content into a shape MiMo accepts.
//
// MiMo is OpenAI-compatible for the common case, but its request validation is
// stricter than OpenAI's in ways that break drop-in clients (notably Codex via
// the Responses->Chat fallback):
//
//  1. A message whose content is an array of text-only parts is frequently
//     rejected; MiMo expects a plain string. We collapse all-text arrays into a
//     single string.
//  2. A text content part must carry a non-empty `text`. A bare `{"type":"text"}`
//     (which Bifrost emits when the upstream text is nil) makes MiMo 400 with
//     "Param Incorrect: `text` is not set". We drop empty text parts.
//  3. A message that carries an image/audio part MUST also carry a non-empty
//     text part, otherwise MiMo returns the same "`text` is not set" error. We
//     ensure a valid text part exists, injecting a placeholder when the client
//     sent none.
//  4. Tool and assistant messages must use string content (array content is not
//     accepted), so we always collapse those to a string.
func normalizeMiMoChatRequest(request *schemas.BifrostChatRequest) {
	if request == nil {
		return
	}
	for i := range request.Input {
		normalizeMiMoMessageContent(&request.Input[i])
	}
	forceMiMoToolBehavior(request)
	injectMiMoToolNudge(request)
}

// miMoToolNudge is a directive instruction injected for MiMo whenever tools are
// available. MiMo (especially via the Codex Responses->Chat path) tends to
// announce an intended action and then end the turn without emitting the tool
// call ("let me activate it..." then stops). A concrete, recency-weighted
// instruction to call tools directly is the highest-leverage mitigation
// documented by mimo2codex / codex-bridge for this exact behavior.
const miMoToolNudge = "[IMPORTANT TOOL POLICY] You are an autonomous agent. " +
	"Whenever you decide to perform an action that one of the available tools can do, " +
	"you MUST immediately call that tool in this SAME turn. " +
	"Never end your turn by only describing or announcing what you are about to do. " +
	"当你打算执行某个可用工具能完成的操作时，必须在本轮立即调用该工具，" +
	"不要只描述将要做的事就结束回合。"

// injectMiMoToolNudge inserts the tool-policy instruction as a system message,
// placed right after any leading system/developer messages so it augments
// (rather than overrides) the client's own system prompt. It is a no-op when no
// tools are present.
func injectMiMoToolNudge(request *schemas.BifrostChatRequest) {
	if request.Params == nil || len(request.Params.Tools) == 0 {
		return
	}

	nudge := schemas.ChatMessage{
		Role:    schemas.ChatMessageRoleSystem,
		Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr(miMoToolNudge)},
	}

	insertAt := 0
	for insertAt < len(request.Input) {
		role := request.Input[insertAt].Role
		if role != schemas.ChatMessageRoleSystem && role != schemas.ChatMessageRoleDeveloper {
			break
		}
		insertAt++
	}

	request.Input = append(request.Input, schemas.ChatMessage{})
	copy(request.Input[insertAt+1:], request.Input[insertAt:])
	request.Input[insertAt] = nudge
}

// forceMiMoToolBehavior aligns tool-calling parameters with MiMo's weaker
// agentic behavior. MiMo (especially via the Codex Responses->Chat path) tends
// to "narrate" the next action (e.g. "let me activate it...") and end the turn
// without emitting a tool call. Codex defaults parallel_tool_calls to false,
// which makes this worse — MiMo commits to a single serial call per turn and
// frequently gives up. Forcing it on lets MiMo batch tool calls per turn and is
// the documented mitigation used by mimo2codex / codex-bridge.
func forceMiMoToolBehavior(request *schemas.BifrostChatRequest) {
	if request.Params == nil || len(request.Params.Tools) == 0 {
		return
	}
	enabled := true
	request.Params.ParallelToolCalls = &enabled
}

func normalizeMiMoMessageContent(msg *schemas.ChatMessage) {
	if msg == nil || msg.Content == nil {
		return
	}

	// Tool and assistant messages must use plain string content on MiMo.
	forceString := msg.Role == schemas.ChatMessageRoleTool || msg.Role == schemas.ChatMessageRoleAssistant

	if msg.Content.ContentBlocks == nil {
		// Already a string (or nil): normalize a bare empty/nil string for
		// roles that require a present string content.
		return
	}

	blocks := msg.Content.ContentBlocks
	keepMultimodal := !forceString
	hasMultimodal := false
	var textParts []string
	for _, block := range blocks {
		switch block.Type {
		case schemas.ChatContentBlockTypeText:
			if block.Text != nil && *block.Text != "" {
				textParts = append(textParts, *block.Text)
			}
		case schemas.ChatContentBlockTypeImage, schemas.ChatContentBlockTypeInputAudio:
			if keepMultimodal {
				hasMultimodal = true
			}
		default:
			// File / refusal / unknown blocks: MiMo's chat API can't parse them;
			// fold any text we can recover and drop the rest.
			if block.Text != nil && *block.Text != "" {
				textParts = append(textParts, *block.Text)
			}
		}
	}

	// No multimodal parts to preserve: collapse to a single string.
	if !hasMultimodal {
		joined := strings.Join(textParts, "\n")
		msg.Content = &schemas.ChatMessageContent{ContentStr: &joined}
		return
	}

	// Mixed content (image/audio + text): rebuild with exactly one text part
	// followed by the preserved multimodal parts.
	text := strings.Join(textParts, "\n")
	if text == "" {
		text = placeholderText
	}
	normalized := make([]schemas.ChatContentBlock, 0, len(blocks)+1)
	normalized = append(normalized, schemas.ChatContentBlock{
		Type: schemas.ChatContentBlockTypeText,
		Text: &text,
	})
	for _, block := range blocks {
		switch block.Type {
		case schemas.ChatContentBlockTypeImage, schemas.ChatContentBlockTypeInputAudio:
			normalized = append(normalized, block)
		}
	}
	msg.Content = &schemas.ChatMessageContent{ContentBlocks: normalized}
}
