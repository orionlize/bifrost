package semanticcache

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"
)

func TestNormalizeEmbeddingURL(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"https://api.openai.com/v1/embeddings", "https://api.openai.com/v1/embeddings"},
		{"https://api.openai.com/v1", "https://api.openai.com/v1/embeddings"},
		{"https://api.openai.com/v1/", "https://api.openai.com/v1/embeddings"},
	}
	for _, tc := range tests {
		require.Equal(t, tc.want, normalizeEmbeddingURL(tc.in))
	}
}

func TestGenerateDirectEmbedding_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
		require.Equal(t, "/v1/embeddings", r.URL.Path)

		var body directEmbeddingRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.Equal(t, "hello", body.Input)
		require.Equal(t, "text-embedding-3-small", body.Model)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]}],"usage":{"total_tokens":3}}`))
	}))
	t.Cleanup(server.Close)

	plugin := &Plugin{
		config: &Config{
			EmbeddingURL:    server.URL + "/v1",
			EmbeddingAPIKey: schemas.NewEnvVar("test-key"),
			EmbeddingModel:  "text-embedding-3-small",
			Dimension:       3,
		},
	}

	emb, tokens, err := plugin.generateDirectEmbedding(context.Background(), "hello")
	require.NoError(t, err)
	require.Equal(t, 3, tokens)
	require.Equal(t, []float32{0.1, 0.2, 0.3}, emb)
}

func TestConfigValidateEmbeddingMode(t *testing.T) {
	cfg := &Config{
		EmbeddingURL:    "https://api.openai.com/v1/embeddings",
		EmbeddingAPIKey: schemas.NewEnvVar("sk-test"),
		EmbeddingModel:  "text-embedding-3-small",
		Dimension:       1536,
	}
	require.NoError(t, cfg.validateEmbeddingMode())
	require.True(t, cfg.usesDirectEmbedding())
	require.True(t, cfg.hasSemanticEmbeddingConfig())
}

func TestConfigValidateEmbeddingMode_RejectsBothModes(t *testing.T) {
	cfg := &Config{
		Provider:        schemas.OpenAI,
		EmbeddingURL:    "https://api.openai.com/v1/embeddings",
		EmbeddingAPIKey: schemas.NewEnvVar("sk-test"),
		EmbeddingModel:  "text-embedding-3-small",
		Dimension:       1536,
	}
	require.Error(t, cfg.validateEmbeddingMode())
}

func TestConfigRedacted(t *testing.T) {
	cfg := &Config{
		EmbeddingAPIKey: schemas.NewEnvVar("sk-super-secret-key-value"),
	}
	redacted := cfg.Redacted()
	require.True(t, redacted.EmbeddingAPIKey.IsRedacted())
}
