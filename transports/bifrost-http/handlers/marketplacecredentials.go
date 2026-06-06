package handlers

import (
	"encoding/json"
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/valyala/fasthttp"
)

func (h *MarketplaceHandler) getMyGitCredentials(ctx *fasthttp.RequestCtx) {
	if !requireMarketplaceSession(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusUnauthorized, "Authentication required")
		return
	}

	ownerID, err := resolveMarketplaceCredentialOwnerID(ctx, h.configStore)
	if err != nil {
		SendError(ctx, err.status, err.message)
		return
	}

	row, storeErr := h.configStore.GetMarketplaceUserGitCredentials(ctx, ownerID)
	if storeErr != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to load git credentials")
		return
	}

	status := &schemas.MarketplaceUserGitCredentialsStatus{
		GitHubTokenConfigured: strings.TrimSpace(row.GitHubToken) != "",
		GitLabTokenConfigured: strings.TrimSpace(row.GitLabToken) != "",
	}
	SendJSON(ctx, map[string]any{"git_credentials": status})
}

func (h *MarketplaceHandler) updateMyGitCredentials(ctx *fasthttp.RequestCtx) {
	if !requireMarketplaceSession(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusUnauthorized, "Authentication required")
		return
	}

	ownerID, err := resolveMarketplaceCredentialOwnerID(ctx, h.configStore)
	if err != nil {
		SendError(ctx, err.status, err.message)
		return
	}

	var req schemas.MarketplaceUserGitCredentialsUpdate
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request body")
		return
	}
	if req.GitHubToken == nil && req.GitLabToken == nil {
		SendError(ctx, fasthttp.StatusBadRequest, "At least one token field is required")
		return
	}

	status, storeErr := h.configStore.UpdateMarketplaceUserGitCredentials(ctx, ownerID, &req)
	if storeErr != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to update git credentials")
		return
	}
	SendJSON(ctx, map[string]any{"git_credentials": status})
}

func requireMarketplaceSession(ctx *fasthttp.RequestCtx, store configstore.ConfigStore) bool {
	if store == nil {
		return false
	}
	authConfig, err := store.GetAuthConfig(ctx)
	if err != nil {
		return false
	}
	if authConfig == nil || !authConfig.IsEnabled {
		return true
	}
	return requireDashboardSession(ctx, store)
}

func resolveMarketplaceCredentialOwnerID(ctx *fasthttp.RequestCtx, store configstore.ConfigStore) (string, *marketplaceAuthError) {
	authConfig, err := store.GetAuthConfig(ctx)
	if err != nil {
		return "", &marketplaceAuthError{fasthttp.StatusInternalServerError, "Failed to resolve auth config"}
	}
	if authConfig == nil || !authConfig.IsEnabled {
		return "default", nil
	}

	if aoneUserID, authErr := resolveMarketplaceAoneUserID(ctx, store); authErr == nil {
		return aoneUserID, nil
	}

	if requireLocalAdmin(ctx, store) {
		token := strings.TrimSpace(sessionTokenFromRequest(ctx))
		if token != "" {
			return "session:" + encrypt.HashSHA256(token), nil
		}
	}

	if token, ok := ctx.UserValue(schemas.BifrostContextKeySessionToken).(string); ok && strings.TrimSpace(token) != "" {
		return "session:" + encrypt.HashSHA256(strings.TrimSpace(token)), nil
	}

	return "", &marketplaceAuthError{fasthttp.StatusUnauthorized, "Authentication required"}
}

func (h *MarketplaceHandler) resolveGitTokenForImport(
	ctx *fasthttp.RequestCtx,
	sourceType schemas.MarketplaceImportSourceType,
	formToken string,
) string {
	if token := strings.TrimSpace(formToken); token != "" {
		return token
	}

	ownerID, err := resolveMarketplaceCredentialOwnerID(ctx, h.configStore)
	if err != nil {
		return ""
	}

	row, loadErr := h.configStore.GetMarketplaceUserGitCredentials(ctx, ownerID)
	if loadErr != nil {
		return ""
	}

	switch sourceType {
	case schemas.MarketplaceImportSourceGitLab:
		return strings.TrimSpace(row.GitLabToken)
	default:
		return strings.TrimSpace(row.GitHubToken)
	}
}
