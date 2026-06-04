package semanticcache

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/bytedance/sonic"
)

func (c *Config) usesDirectEmbedding() bool {
	if c == nil {
		return false
	}
	return strings.TrimSpace(c.EmbeddingURL) != "" &&
		c.EmbeddingAPIKey != nil &&
		c.EmbeddingAPIKey.IsSet()
}

// NormalizeDirectOnly clears embedding fields when dimension <= 1 (direct-only cache).
func (c *Config) NormalizeDirectOnly() {
	if c == nil || c.Dimension > 1 {
		return
	}
	c.Provider = ""
	c.EmbeddingURL = ""
	c.EmbeddingModel = ""
	c.EmbeddingAPIKey = nil
}

func (c *Config) usesProviderEmbedding() bool {
	if c == nil {
		return false
	}
	return c.Provider != ""
}

func (c *Config) hasSemanticEmbeddingConfig() bool {
	if c == nil {
		return false
	}
	if strings.TrimSpace(c.EmbeddingModel) == "" || c.Dimension <= 1 {
		return false
	}
	return c.usesDirectEmbedding() || c.usesProviderEmbedding()
}

func (c *Config) validateEmbeddingMode() error {
	if c == nil {
		return fmt.Errorf("config is required")
	}
	if c.usesDirectEmbedding() && c.usesProviderEmbedding() {
		return fmt.Errorf("cannot set both provider and embedding_url; use one embedding mode")
	}
	if c.usesDirectEmbedding() {
		if strings.TrimSpace(c.EmbeddingURL) == "" {
			return fmt.Errorf("embedding_url is required for direct embedding mode")
		}
		if c.EmbeddingAPIKey == nil || !c.EmbeddingAPIKey.IsSet() {
			return fmt.Errorf("embedding_api_key is required for direct embedding mode")
		}
		if strings.TrimSpace(c.EmbeddingModel) == "" {
			return fmt.Errorf("embedding_model is required for direct embedding mode")
		}
		if c.Dimension <= 1 {
			return fmt.Errorf("dimension must be > 1 for direct embedding mode")
		}
	}
	if c.usesProviderEmbedding() {
		if strings.TrimSpace(c.EmbeddingModel) == "" {
			return fmt.Errorf("embedding_model is required when provider is set")
		}
		if c.Dimension <= 1 {
			return fmt.Errorf("dimension must be > 1 when provider is set (got dimension=%d, provider=%q); use dimension: 1 without provider for direct-only mode", c.Dimension, c.Provider)
		}
	}
	return nil
}

func (c *Config) Redacted() *Config {
	if c == nil {
		return nil
	}
	out := *c
	if out.EmbeddingAPIKey != nil {
		out.EmbeddingAPIKey = out.EmbeddingAPIKey.Redacted()
	}
	return &out
}

func (c *Config) MarshalForStorage() ([]byte, error) {
	return json.Marshal(c)
}

// SanitizeConfigMap normalizes a stored plugin config map (e.g. strips provider when dimension is 1).
func SanitizeConfigMap(raw map[string]any) (map[string]any, error) {
	if raw == nil {
		return nil, nil
	}
	b, err := sonic.Marshal(raw)
	if err != nil {
		return raw, err
	}
	var c Config
	if err := sonic.Unmarshal(b, &c); err != nil {
		return raw, err
	}
	c.NormalizeDirectOnly()
	out, err := sonic.Marshal(c)
	if err != nil {
		return raw, err
	}
	var result map[string]any
	if err := sonic.Unmarshal(out, &result); err != nil {
		return raw, err
	}
	return result, nil
}
