package semanticcache

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const directEmbeddingTimeout = 30 * time.Second

type directEmbeddingRequest struct {
	Input string `json:"input"`
	Model string `json:"model"`
}

type directEmbeddingResponse struct {
	Data []struct {
		Embedding []float64 `json:"embedding"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
	Usage *struct {
		PromptTokens int `json:"prompt_tokens"`
		TotalTokens  int `json:"total_tokens"`
	} `json:"usage"`
}

func normalizeEmbeddingURL(raw string) string {
	u := strings.TrimRight(strings.TrimSpace(raw), "/")
	if strings.HasSuffix(u, "/embeddings") {
		return u
	}
	return u + "/embeddings"
}

func (plugin *Plugin) generateDirectEmbedding(ctx context.Context, text string) ([]float32, int, error) {
	if plugin.config == nil {
		return nil, 0, fmt.Errorf("semantic cache config is not set")
	}
	url := normalizeEmbeddingURL(plugin.config.EmbeddingURL)
	apiKey := ""
	if plugin.config.EmbeddingAPIKey != nil {
		apiKey = strings.TrimSpace(plugin.config.EmbeddingAPIKey.GetValue())
	}
	if url == "" {
		return nil, 0, fmt.Errorf("embedding_url is required for direct embedding mode")
	}
	if apiKey == "" {
		return nil, 0, fmt.Errorf("embedding_api_key is required for direct embedding mode")
	}
	model := strings.TrimSpace(plugin.config.EmbeddingModel)
	if model == "" {
		return nil, 0, fmt.Errorf("embedding_model is required for direct embedding mode")
	}

	body, err := json.Marshal(directEmbeddingRequest{Input: text, Model: model})
	if err != nil {
		return nil, 0, fmt.Errorf("failed to marshal embedding request: %w", err)
	}

	reqCtx, cancel := context.WithTimeout(ctx, directEmbeddingTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, 0, fmt.Errorf("failed to create embedding request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("embedding request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to read embedding response: %w", err)
	}

	var parsed directEmbeddingResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, 0, fmt.Errorf("failed to parse embedding response: %w", err)
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return nil, 0, fmt.Errorf("embedding API error: %s", parsed.Error.Message)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(respBody))
		if msg == "" {
			msg = resp.Status
		}
		return nil, 0, fmt.Errorf("embedding API returned status %d: %s", resp.StatusCode, msg)
	}
	if len(parsed.Data) == 0 || len(parsed.Data[0].Embedding) == 0 {
		return nil, 0, fmt.Errorf("no embeddings returned from embedding API")
	}

	inputTokens := 0
	if parsed.Usage != nil {
		inputTokens = parsed.Usage.TotalTokens
		if inputTokens == 0 {
			inputTokens = parsed.Usage.PromptTokens
		}
	}

	return float64ToFloat32Embedding(parsed.Data[0].Embedding), inputTokens, nil
}
