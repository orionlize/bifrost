package logging

import (
	"strings"
	"unicode"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/logstore"
)

const minInlineBinaryLen = 256

func binaryTypePlaceholder(mediaType string) string {
	if mediaType == "" {
		return "[binary]"
	}
	return "[" + mediaType + "]"
}

func mimeFromDataURL(s string) (string, bool) {
	if !strings.HasPrefix(s, "data:") {
		return "", false
	}
	rest := s[5:]
	semi := strings.IndexByte(rest, ';')
	if semi == -1 {
		if comma := strings.IndexByte(rest, ','); comma != -1 {
			return rest[:comma], true
		}
		if rest != "" {
			return rest, true
		}
		return "", true
	}
	if semi == 0 {
		return "", true
	}
	return rest[:semi], true
}

func isExternalURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

func isLikelyBase64Payload(s string) bool {
	if len(s) < minInlineBinaryLen {
		return false
	}
	valid := 0
	for _, r := range s {
		switch {
		case unicode.IsLetter(r), unicode.IsDigit(r):
			valid++
		case r == '+', r == '/', r == '=', r == '-', r == '_':
			valid++
		default:
			return false
		}
	}
	return valid == len(s)
}

func isInlineBinaryString(s string) bool {
	if s == "" {
		return false
	}
	if strings.HasPrefix(s, "data:") {
		return true
	}
	if isExternalURL(s) {
		return false
	}
	return len(s) >= minInlineBinaryLen && isLikelyBase64Payload(s)
}

func redactInlineBinaryString(s, fallbackType string) string {
	if mime, ok := mimeFromDataURL(s); ok && mime != "" {
		return binaryTypePlaceholder(mime)
	}
	return binaryTypePlaceholder(fallbackType)
}

func redactOptionalStringPtr(v *string, fallbackType string) *string {
	if v == nil || *v == "" {
		return v
	}
	if !isInlineBinaryString(*v) {
		return v
	}
	p := redactInlineBinaryString(*v, fallbackType)
	return &p
}

func redactInlineBinaryStringValue(s, fallbackType string) string {
	if s == "" || !isInlineBinaryString(s) {
		return s
	}
	return redactInlineBinaryString(s, fallbackType)
}

func sanitizeChatContentBlock(block schemas.ChatContentBlock) schemas.ChatContentBlock {
	switch block.Type {
	case schemas.ChatContentBlockTypeImage:
		if block.ImageURLStruct != nil {
			img := *block.ImageURLStruct
			img.URL = redactInlineBinaryStringValue(img.URL, "image")
			block.ImageURLStruct = &img
		}
	case schemas.ChatContentBlockTypeInputAudio:
		if block.InputAudio != nil && block.InputAudio.Data != "" {
			format := "audio"
			if block.InputAudio.Format != nil && *block.InputAudio.Format != "" {
				format = "audio/" + *block.InputAudio.Format
			}
			audio := *block.InputAudio
			audio.Data = redactInlineBinaryStringValue(audio.Data, format)
			block.InputAudio = &audio
		}
	case schemas.ChatContentBlockTypeFile:
		if block.File != nil {
			file := *block.File
			fileType := ""
			if file.FileType != nil {
				fileType = *file.FileType
			}
			if file.FileData != nil && *file.FileData != "" {
				p := binaryTypePlaceholder(fileType)
				if fileType == "" {
					p = redactInlineBinaryString(*file.FileData, "file")
				}
				file.FileData = &p
			}
			file.FileURL = redactOptionalStringPtr(file.FileURL, fileType)
			block.File = &file
		}
	}
	return block
}

func sanitizeChatMessageContent(content *schemas.ChatMessageContent) {
	if content == nil || content.ContentBlocks == nil {
		return
	}
	for i, block := range content.ContentBlocks {
		content.ContentBlocks[i] = sanitizeChatContentBlock(block)
	}
}

func sanitizeChatMessage(msg schemas.ChatMessage) schemas.ChatMessage {
	sanitizeChatMessageContent(msg.Content)
	return msg
}

func sanitizeResponsesContentBlock(block schemas.ResponsesMessageContentBlock) schemas.ResponsesMessageContentBlock {
	if block.ResponsesInputMessageContentBlockImage != nil {
		img := *block.ResponsesInputMessageContentBlockImage
		img.ImageURL = redactOptionalStringPtr(img.ImageURL, "image")
		block.ResponsesInputMessageContentBlockImage = &img
	}
	if block.ResponsesInputMessageContentBlockFile != nil {
		file := *block.ResponsesInputMessageContentBlockFile
		fileType := ""
		if file.FileType != nil {
			fileType = *file.FileType
		}
		if file.FileData != nil && *file.FileData != "" {
			p := binaryTypePlaceholder(fileType)
			if fileType == "" {
				p = redactInlineBinaryString(*file.FileData, "file")
			}
			file.FileData = &p
		}
		file.FileURL = redactOptionalStringPtr(file.FileURL, fileType)
		block.ResponsesInputMessageContentBlockFile = &file
	}
	if block.Audio != nil && block.Audio.Data != "" {
		format := "audio"
		if block.Audio.Format != "" {
			format = "audio/" + block.Audio.Format
		}
		audio := *block.Audio
		audio.Data = redactInlineBinaryStringValue(audio.Data, format)
		block.Audio = &audio
	}
	return block
}

func sanitizeResponsesMessageContent(content *schemas.ResponsesMessageContent) {
	if content == nil || content.ContentBlocks == nil {
		return
	}
	for i, block := range content.ContentBlocks {
		content.ContentBlocks[i] = sanitizeResponsesContentBlock(block)
	}
}

func sanitizeResponsesToolOutput(output *schemas.ResponsesToolMessageOutputStruct) {
	if output == nil {
		return
	}
	if output.ResponsesComputerToolCallOutput != nil {
		out := *output.ResponsesComputerToolCallOutput
		out.ImageURL = redactOptionalStringPtr(out.ImageURL, "image")
		output.ResponsesComputerToolCallOutput = &out
	}
	if output.ResponsesFunctionToolCallOutputBlocks != nil {
		for i, block := range output.ResponsesFunctionToolCallOutputBlocks {
			output.ResponsesFunctionToolCallOutputBlocks[i] = sanitizeResponsesContentBlock(block)
		}
	}
}

func sanitizeResponsesMessage(msg schemas.ResponsesMessage) schemas.ResponsesMessage {
	sanitizeResponsesMessageContent(msg.Content)
	tool := msg.ResponsesToolMessage
	if tool == nil {
		return msg
	}
	if tool.Output != nil {
		sanitizeResponsesToolOutput(tool.Output)
	}
	if tool.ResponsesImageGenerationCall != nil && isInlineBinaryString(tool.ResponsesImageGenerationCall.Result) {
		call := *tool.ResponsesImageGenerationCall
		call.Result = redactInlineBinaryString(call.Result, "image")
		tool.ResponsesImageGenerationCall = &call
	}
	if tool.ResponsesCodeInterpreterToolCall != nil {
		call := *tool.ResponsesCodeInterpreterToolCall
		for i, out := range call.Outputs {
			if out.ResponsesCodeInterpreterOutputImage != nil {
				img := *out.ResponsesCodeInterpreterOutputImage
				img.URL = redactInlineBinaryStringValue(img.URL, "image")
				out.ResponsesCodeInterpreterOutputImage = &img
				call.Outputs[i] = out
			}
		}
		tool.ResponsesCodeInterpreterToolCall = &call
	}
	return msg
}

func sanitizeTranscriptionInput(input *schemas.TranscriptionInput) {
	if input == nil || len(input.File) == 0 {
		return
	}
	input.File = nil
}

func sanitizeOCRDocument(doc *schemas.OCRDocument) {
	if doc == nil {
		return
	}
	doc.DocumentURL = redactOptionalStringPtr(doc.DocumentURL, "file")
	doc.ImageURL = redactOptionalStringPtr(doc.ImageURL, "image")
}

func sanitizeOCRResponse(resp *schemas.BifrostOCRResponse) {
	if resp == nil {
		return
	}
	for i := range resp.Pages {
		for j := range resp.Pages[i].Images {
			if resp.Pages[i].Images[j].ImageBase64 != nil && *resp.Pages[i].Images[j].ImageBase64 != "" {
				p := binaryTypePlaceholder("image")
				resp.Pages[i].Images[j].ImageBase64 = &p
			}
		}
	}
}

func sanitizeImageEditInput(input *schemas.ImageEditInput) {
	if input == nil {
		return
	}
	for i := range input.Images {
		if len(input.Images[i].Image) > 0 {
			input.Images[i].Image = nil
		}
	}
}

func sanitizeImageVariationInput(input *schemas.ImageVariationInput) {
	if input == nil {
		return
	}
	if len(input.Image.Image) > 0 {
		input.Image.Image = nil
	}
}

func sanitizeVideoGenerationInput(input *schemas.VideoGenerationInput) {
	if input == nil {
		return
	}
	input.InputReference = redactOptionalStringPtr(input.InputReference, "image")
}

func sanitizeSpeechOutput(output *schemas.BifrostSpeechResponse) {
	if output == nil {
		return
	}
	if len(output.Audio) > 0 {
		output.Audio = nil
	}
	if output.AudioBase64 != nil && *output.AudioBase64 != "" {
		p := binaryTypePlaceholder("audio")
		output.AudioBase64 = &p
	}
}

func sanitizeImageGenerationOutput(output *schemas.BifrostImageGenerationResponse) {
	if output == nil {
		return
	}
	for i := range output.Data {
		data := &output.Data[i]
		if data.B64JSON != "" {
			data.B64JSON = binaryTypePlaceholder("image")
		}
		data.URL = redactInlineBinaryStringValue(data.URL, "image")
	}
}

func sanitizeLogParams(params interface{}) {
	switch p := params.(type) {
	case *schemas.ImageGenerationParameters:
		if p == nil {
			return
		}
		for i, img := range p.InputImages {
			p.InputImages[i] = redactInlineBinaryStringValue(img, "image")
		}
	case schemas.ImageGenerationParameters:
		sanitizeLogParams(&p)
	case *schemas.ImageEditParameters:
		if p == nil {
			return
		}
		if len(p.Mask) > 0 {
			p.Mask = nil
		}
	case schemas.ImageEditParameters:
		sanitizeLogParams(&p)
	}
}

func sanitizeLogEntryBinaryContent(entry *logstore.Log) {
	if entry == nil {
		return
	}

	for i, msg := range entry.InputHistoryParsed {
		entry.InputHistoryParsed[i] = sanitizeChatMessage(msg)
	}
	if entry.OutputMessageParsed != nil {
		sanitized := sanitizeChatMessage(*entry.OutputMessageParsed)
		entry.OutputMessageParsed = &sanitized
	}

	for i, msg := range entry.ResponsesInputHistoryParsed {
		entry.ResponsesInputHistoryParsed[i] = sanitizeResponsesMessage(msg)
	}
	for i, msg := range entry.ResponsesOutputParsed {
		entry.ResponsesOutputParsed[i] = sanitizeResponsesMessage(msg)
	}

	sanitizeTranscriptionInput(entry.TranscriptionInputParsed)
	sanitizeOCRDocument(entry.OCRInputParsed)
	sanitizeOCRResponse(entry.OCROutputParsed)
	sanitizeImageEditInput(entry.ImageEditInputParsed)
	sanitizeImageVariationInput(entry.ImageVariationInputParsed)
	sanitizeVideoGenerationInput(entry.VideoGenerationInputParsed)
	sanitizeSpeechOutput(entry.SpeechOutputParsed)
	sanitizeImageGenerationOutput(entry.ImageGenerationOutputParsed)
	sanitizeLogParams(entry.ParamsParsed)
}
