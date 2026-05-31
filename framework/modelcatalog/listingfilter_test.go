package modelcatalog

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
)

func TestShouldListModelUnderProvider_OpenAIExcludesGemini(t *testing.T) {
	assert.False(t, ShouldListModelUnderProvider(schemas.OpenAI, "gemini-2.0-flash"))
	assert.False(t, ShouldListModelUnderProvider(schemas.OpenAI, "google/gemini-2.0-flash"))
	assert.False(t, ShouldListModelUnderProvider(schemas.OpenAI, "claude-3-5-sonnet-20241022"))
	assert.True(t, ShouldListModelUnderProvider(schemas.OpenAI, "gpt-4o"))
	assert.True(t, ShouldListModelUnderProvider(schemas.OpenAI, "gpt-4o-mini"))
}

func TestShouldListModelUnderProvider_GeminiExcludesGPT(t *testing.T) {
	assert.False(t, ShouldListModelUnderProvider(schemas.Gemini, "gpt-4o"))
	assert.True(t, ShouldListModelUnderProvider(schemas.Gemini, "gemini-2.0-flash"))
}

func TestShouldListModelUnderProvider_OpenRouterAllowsNested(t *testing.T) {
	assert.True(t, ShouldListModelUnderProvider(schemas.OpenRouter, "openai/gpt-4o"))
	assert.True(t, ShouldListModelUnderProvider(schemas.OpenRouter, "google/gemini-2.0-flash"))
}
