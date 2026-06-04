// Package openaicache provides a gateway-level LLM plugin that cuts the cost of
// long-lived OpenAI/Azure sessions whose prompt cache expires while the user is
// idle.
//
// Problem: OpenAI's automatic prompt cache evicts a prefix after ~5-10 minutes
// of inactivity (up to ~1h off-peak). A user who pauses a conversation past that
// window forces the next turn to re-process the entire history at full input
// price instead of the ~0.1x cache-read price. The fix is two provider-native
// knobs that the request almost never sets on its own:
//
//   - prompt_cache_retention: "24h" extends the cache window to 24 hours so an
//     idle gap no longer evicts the cached prefix. (gpt-5.5+ default to 24h and
//     reject "in_memory"; older models keep ~10m unless told otherwise.) Only
//     "24h" is broadly safe to inject, so it is the default.
//   - prompt_cache_key: a stable per-conversation key that routes a session's
//     turns to the same cache node, improving hit rate.
//
// Both are lossless — the plugin never touches conversation content. It maps to:
//   - Chat Completions:  prompt_cache_retention / prompt_cache_key
//   - Responses API:     prompt_cache_retention / prompt_cache_key
//
// OpenAI-family-compatible third parties (groq, cerebras, ...) do not honor
// these fields and strip them downstream, so the plugin targets openai + azure
// by default.
package openaicache

import (
	"hash"
	"hash/fnv"
	"strconv"

	"github.com/maximhq/bifrost/core/schemas"
)

// PluginName is the stable identifier used to register and reference the plugin.
const PluginName = "openai-cache"

// defaultRetention is the only value that is broadly safe to inject across all
// OpenAI models (gpt-5.5+ reject "in_memory").
const defaultRetention = "24h"

// cacheKeyPrefix namespaces derived keys so they never collide with a key the
// caller set deliberately.
const cacheKeyPrefix = "bf-"

// Config controls cache-retention / cache-key injection behavior.
type Config struct {
	// Providers is the set of providers this plugin applies to. When empty it
	// defaults to openai + azure (the only providers that honor these fields).
	Providers []schemas.ModelProvider `json:"providers,omitempty"`

	// Retention is injected as prompt_cache_retention when the request sets none
	// (default "24h"). Empty string disables retention injection.
	Retention string `json:"retention,omitempty"`

	// DisableRetention skips retention injection entirely. Set this for
	// zero-data-retention (ZDR) organizations: ZDR forces "in_memory" and
	// extended ("24h") retention is not available, so injecting it is invalid.
	DisableRetention *bool `json:"disable_retention,omitempty"`

	// InjectCacheKey derives and injects a stable prompt_cache_key from the
	// request's stable prefix when the request sets none (default true).
	InjectCacheKey *bool `json:"inject_cache_key,omitempty"`
}

// Plugin implements schemas.LLMPlugin.
type Plugin struct {
	providers      map[schemas.ModelProvider]struct{}
	retention      string
	injectCacheKey bool
}

// Init constructs the plugin from config, applying defaults for unset fields.
func Init(config *Config) (*Plugin, error) {
	if config == nil {
		config = &Config{}
	}

	providers := config.Providers
	if len(providers) == 0 {
		providers = []schemas.ModelProvider{schemas.OpenAI, schemas.Azure}
	}
	providerSet := make(map[schemas.ModelProvider]struct{}, len(providers))
	for _, p := range providers {
		providerSet[p] = struct{}{}
	}

	retention := defaultRetention
	if config.Retention != "" {
		retention = config.Retention
	}
	if config.DisableRetention != nil && *config.DisableRetention {
		retention = ""
	}

	return &Plugin{
		providers:      providerSet,
		retention:      retention,
		injectCacheKey: boolOr(config.InjectCacheKey, true),
	}, nil
}

// GetName returns the plugin name.
func (p *Plugin) GetName() string {
	return PluginName
}

// PreLLMHook injects prompt_cache_retention and prompt_cache_key when absent.
func (p *Plugin) PreLLMHook(ctx *schemas.BifrostContext, req *schemas.BifrostRequest) (*schemas.BifrostRequest, *schemas.LLMPluginShortCircuit, error) {
	if req == nil {
		return req, nil, nil
	}

	switch {
	case req.ChatRequest != nil:
		if _, ok := p.providers[req.ChatRequest.Provider]; ok {
			p.applyChat(req.ChatRequest)
		}
	case req.ResponsesRequest != nil:
		if _, ok := p.providers[req.ResponsesRequest.Provider]; ok {
			p.applyResponses(req.ResponsesRequest)
		}
	}

	return req, nil, nil
}

// PostLLMHook is a no-op; this plugin only mutates requests.
func (p *Plugin) PostLLMHook(ctx *schemas.BifrostContext, resp *schemas.BifrostResponse, bifrostErr *schemas.BifrostError) (*schemas.BifrostResponse, *schemas.BifrostError, error) {
	return resp, bifrostErr, nil
}

// Cleanup releases resources (none held).
func (p *Plugin) Cleanup() error {
	return nil
}

func (p *Plugin) applyChat(req *schemas.BifrostChatRequest) {
	if p.retention == "" && !p.injectCacheKey {
		return
	}
	if req.Params == nil {
		req.Params = &schemas.ChatParameters{}
	}

	if p.retention != "" && req.Params.PromptCacheRetention == nil {
		v := p.retention
		req.Params.PromptCacheRetention = &v
	}

	if p.injectCacheKey && req.Params.PromptCacheKey == nil {
		if key := chatCacheKey(req.Input); key != "" {
			req.Params.PromptCacheKey = &key
		}
	}
}

func (p *Plugin) applyResponses(req *schemas.BifrostResponsesRequest) {
	if p.retention == "" && !p.injectCacheKey {
		return
	}
	if req.Params == nil {
		req.Params = &schemas.ResponsesParameters{}
	}

	if p.retention != "" && req.Params.PromptCacheRetention == nil {
		v := p.retention
		req.Params.PromptCacheRetention = &v
	}

	if p.injectCacheKey && req.Params.PromptCacheKey == nil {
		if key := responsesCacheKey(req.Input); key != "" {
			req.Params.PromptCacheKey = &key
		}
	}
}

// chatCacheKey derives a stable key from the conversation's stable prefix: all
// system/developer messages plus the first user message. This stays constant
// across the turns of a conversation (so a session keeps hitting the same cache)
// while distinguishing conversations that merely share a system prompt.
func chatCacheKey(input []schemas.ChatMessage) string {
	h := fnv.New64a()
	wrote := false

	for i := range input {
		msg := &input[i]
		if msg.Role == schemas.ChatMessageRoleSystem || msg.Role == schemas.ChatMessageRoleDeveloper {
			if writeChatContent(h, msg.Content) {
				wrote = true
			}
		}
	}
	for i := range input {
		msg := &input[i]
		if msg.Role == schemas.ChatMessageRoleUser {
			if writeChatContent(h, msg.Content) {
				wrote = true
			}
			break
		}
	}

	if !wrote {
		return ""
	}
	return cacheKeyPrefix + strconv.FormatUint(h.Sum64(), 16)
}

// responsesCacheKey mirrors chatCacheKey for the Responses API.
func responsesCacheKey(input []schemas.ResponsesMessage) string {
	h := fnv.New64a()
	wrote := false

	for i := range input {
		msg := &input[i]
		if msg.Role != nil && (*msg.Role == schemas.ResponsesInputMessageRoleSystem || *msg.Role == schemas.ResponsesInputMessageRoleDeveloper) {
			if writeResponsesContent(h, msg.Content) {
				wrote = true
			}
		}
	}
	for i := range input {
		msg := &input[i]
		if msg.Role != nil && *msg.Role == schemas.ResponsesInputMessageRoleUser {
			if writeResponsesContent(h, msg.Content) {
				wrote = true
			}
			break
		}
	}

	if !wrote {
		return ""
	}
	return cacheKeyPrefix + strconv.FormatUint(h.Sum64(), 16)
}

func writeChatContent(h hash.Hash64, c *schemas.ChatMessageContent) bool {
	if c == nil {
		return false
	}
	wrote := false
	if c.ContentStr != nil {
		_, _ = h.Write([]byte(*c.ContentStr))
		wrote = true
	}
	for _, b := range c.ContentBlocks {
		if b.Text != nil {
			_, _ = h.Write([]byte(*b.Text))
			wrote = true
		}
	}
	return wrote
}

func writeResponsesContent(h hash.Hash64, c *schemas.ResponsesMessageContent) bool {
	if c == nil {
		return false
	}
	wrote := false
	if c.ContentStr != nil {
		_, _ = h.Write([]byte(*c.ContentStr))
		wrote = true
	}
	for _, b := range c.ContentBlocks {
		if b.Text != nil {
			_, _ = h.Write([]byte(*b.Text))
			wrote = true
		}
	}
	return wrote
}

func boolOr(p *bool, def bool) bool {
	if p == nil {
		return def
	}
	return *p
}
