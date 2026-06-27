package openai

import (
	"strings"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

func TestApplyRawRequestBody(t *testing.T) {
	t.Run("disabled by config does nothing", func(t *testing.T) {
		provider := &OpenAIProvider{useRawRequestBody: false}
		ctx := schemas.NewBifrostContext(nil, schemas.NoDeadline)

		used := provider.applyRawRequestBody(ctx, []byte(`{"model":"gpt-5"}`), func([]byte) {
			t.Fatal("setRawBody should not be called")
		})
		if used {
			t.Fatal("expected raw passthrough to be inactive")
		}
		if v := ctx.Value(schemas.BifrostContextKeyUseRawRequestBody); v != nil {
			t.Fatalf("expected context flag unset, got %v", v)
		}
	})

	t.Run("enabled with empty body does nothing", func(t *testing.T) {
		provider := &OpenAIProvider{useRawRequestBody: true}
		ctx := schemas.NewBifrostContext(nil, schemas.NoDeadline)

		if provider.applyRawRequestBody(ctx, nil, func([]byte) {}) {
			t.Fatal("expected raw passthrough inactive when no raw body captured")
		}
		if v := ctx.Value(schemas.BifrostContextKeyUseRawRequestBody); v != nil {
			t.Fatalf("expected context flag unset, got %v", v)
		}
	})

	t.Run("enabled with raw body sets context flag", func(t *testing.T) {
		provider := &OpenAIProvider{useRawRequestBody: true}
		ctx := schemas.NewBifrostContext(nil, schemas.NoDeadline)

		used := provider.applyRawRequestBody(ctx, []byte(`{"model":"gpt-5"}`), func([]byte) {
			t.Fatal("setRawBody should not be called when disableStore is off")
		})
		if !used {
			t.Fatal("expected raw passthrough active")
		}
		v, ok := ctx.Value(schemas.BifrostContextKeyUseRawRequestBody).(bool)
		if !ok || !v {
			t.Fatalf("expected context flag true, got %v", v)
		}
	})

	t.Run("disableStore rewrites store in raw json", func(t *testing.T) {
		provider := &OpenAIProvider{useRawRequestBody: true, disableStore: true}
		ctx := schemas.NewBifrostContext(nil, schemas.NoDeadline)

		var rewritten []byte
		used := provider.applyRawRequestBody(ctx, []byte(`{"model":"gpt-5","store":true}`), func(b []byte) {
			rewritten = b
		})
		if !used {
			t.Fatal("expected raw passthrough active")
		}
		if !strings.Contains(string(rewritten), `"store":false`) {
			t.Fatalf("expected store overridden to false, got %s", string(rewritten))
		}
	})
}
