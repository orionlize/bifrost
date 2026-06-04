package semanticcache

import (
	"encoding/json"
	"fmt"
	"strings"
)

func (c *Config) usesDirectEmbedding() bool {
	if c == nil {
		return false
	}
	return strings.TrimSpace(c.EmbeddingURL) != "" &&
		c.EmbeddingAPIKey != nil &&
		c.EmbeddingAPIKey.IsSet()
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
			return fmt.Errorf("dimension must be > 0 when provider is set (got dimension=%d, provider=%q)", c.Dimension, c.Provider)
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
