package integrations

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/core/providers/anthropic"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestCheckAnthropicPassthrough_APIKeyFlowPreservesQueryString(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod("POST")
	ctx.Request.SetRequestURI("/anthropic/v1/messages?beta=true")
	ctx.Request.Header.Set("x-api-key", "sk-ant-test")
	ctx.Request.Header.Set("User-Agent", "claude-cli/2.1.156 (external, cli)")

	bifrostCtx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	req := &anthropic.AnthropicMessageRequest{Model: "claude-sonnet-4-20250514"}

	err := checkAnthropicPassthrough(ctx, bifrostCtx, req)
	require.NoError(t, err)

	assert.Equal(t, "/v1/messages?beta=true", bifrostCtx.Value(schemas.BifrostContextKeyURLPath))
	assert.Nil(t, bifrostCtx.Value(schemas.BifrostContextKeySkipKeySelection))
	assert.Equal(t, true, bifrostCtx.Value(schemas.BifrostContextKeyUseRawRequestBody))
}

func TestCheckAnthropicPassthrough_OAuthFlowSkipsKeySelection(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod("POST")
	ctx.Request.SetRequestURI("/anthropic/v1/messages?beta=true")
	ctx.Request.Header.Set("Authorization", "Bearer sk-ant-oat-test-token")
	ctx.Request.Header.Set("User-Agent", "claude-cli/2.1.156 (external, cli)")

	bifrostCtx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	req := &anthropic.AnthropicMessageRequest{Model: "claude-sonnet-4-20250514"}

	err := checkAnthropicPassthrough(ctx, bifrostCtx, req)
	require.NoError(t, err)

	assert.Equal(t, "/v1/messages?beta=true", bifrostCtx.Value(schemas.BifrostContextKeyURLPath))
	assert.Equal(t, true, bifrostCtx.Value(schemas.BifrostContextKeySkipKeySelection))
}
