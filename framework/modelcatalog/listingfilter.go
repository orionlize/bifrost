package modelcatalog

import (
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
)

// nestedModelProviders expose upstream provider/model ids (e.g. openai/gpt-4o on OpenRouter).
var nestedModelProviders = map[schemas.ModelProvider]struct{}{
	schemas.OpenRouter: {},
	schemas.Vertex:     {},
	schemas.Groq:       {},
	schemas.Bedrock:    {},
	schemas.Replicate:  {},
}

// directProviderExclusivePrefixes lists name prefixes that should not appear under a
// direct provider's management listing when the model id has no leading provider slug.
var directProviderExclusivePrefixes = map[string][]string{
	"openai":    {"gemini", "claude", "anthropic/", "google/", "mistral", "meta-llama", "llama-", "command-", "cohere/"},
	"anthropic": {"gemini", "gpt-", "google/", "mistral", "meta-llama", "llama-", "command-", "text-embedding-3", "o1-", "o3-", "o4-"},
	"gemini":    {"gpt-", "claude", "anthropic/", "mistral", "meta-llama", "llama-", "command-"},
	"mistral":   {"gpt-", "gemini", "claude", "anthropic/", "google/"},
	"cohere":    {"gpt-", "gemini", "claude", "anthropic/", "google/"},
}

// ShouldListModelUnderProvider reports whether a model id should be shown in provider-scoped
// management listings (/api/models?provider=…). Direct providers hide cross-vendor ids that
// sometimes land in a provider pool via pricing sync or list-models discovery bleed.
func ShouldListModelUnderProvider(provider schemas.ModelProvider, model string) bool {
	model = strings.TrimSpace(model)
	if model == "" {
		return false
	}
	if _, ok := nestedModelProviders[provider]; ok {
		return true
	}

	leadingProvider, hasPrefix := leadingProviderSlug(model)
	if hasPrefix {
		return strings.EqualFold(leadingProvider, string(provider))
	}

	return !modelNameConflictsWithDirectProvider(string(provider), model)
}

func leadingProviderSlug(model string) (string, bool) {
	parsed, _ := schemas.ParseModelString(model, "")
	if parsed == "" {
		return "", false
	}
	return string(parsed), true
}

func modelNameConflictsWithDirectProvider(provider, model string) bool {
	prefixes, ok := directProviderExclusivePrefixes[strings.ToLower(provider)]
	if !ok {
		return false
	}
	lower := strings.ToLower(model)
	for _, prefix := range prefixes {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}
