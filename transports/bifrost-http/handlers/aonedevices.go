package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

// AoneDevicesHandler serves desktop device authorization APIs for ZD Switch.
type AoneDevicesHandler struct {
	configStore configstore.ConfigStore
	vkReloader  VirtualKeyReloader
}

// NewAoneDevicesHandler creates a device authorization handler.
func NewAoneDevicesHandler(configStore configstore.ConfigStore, vkReloader VirtualKeyReloader) *AoneDevicesHandler {
	return &AoneDevicesHandler{
		configStore: configStore,
		vkReloader:  vkReloader,
	}
}

// RegisterRoutes registers device authorization routes.
func (h *AoneDevicesHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	r.GET("/api/aone/devices", lib.ChainMiddlewares(h.listDevices, middlewares...))
	r.PUT("/api/aone/devices/{id}", lib.ChainMiddlewares(h.updateDevice, middlewares...))
	r.POST("/api/aone/devices/authorize", lib.ChainMiddlewares(h.authorize, middlewares...))
	r.POST("/api/aone/devices/token", lib.ChainMiddlewares(h.token, middlewares...))
	r.POST("/api/aone/devices/revoke", lib.ChainMiddlewares(h.revoke, middlewares...))
}

type aoneDeviceAuthorizeRequest struct {
	DeviceFingerprint string `json:"device_fingerprint"`
	DeviceName        string `json:"device_name"`
}

type aoneDeviceTokenRequest struct {
	AuthorizationCode string `json:"authorization_code"`
	DeviceFingerprint string `json:"device_fingerprint"`
}

type aoneDeviceRevokeRequest struct {
	AuthorizationCode string `json:"authorization_code"`
	DeviceFingerprint string `json:"device_fingerprint"`
}

type updateAoneDeviceRequest struct {
	IsActive *bool `json:"is_active"`
}

func (h *AoneDevicesHandler) listDevices(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	limit, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("limit")))
	offset, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("offset")))
	search := strings.TrimSpace(string(ctx.QueryArgs().Peek("search")))
	status := strings.TrimSpace(string(ctx.QueryArgs().Peek("status")))

	reqCtx := context.Background()
	rows, totalCount, err := h.configStore.GetAoneDeviceAuthorizationsPaginated(reqCtx, configstore.AoneDeviceAuthorizationsQueryParams{
		Limit:  limit,
		Offset: offset,
		Search: search,
		Status: status,
	})
	if err != nil {
		logger.Error("[aone-devices] failed to list devices: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list devices")
		return
	}

	items := make([]map[string]any, 0, len(rows))
	for i := range rows {
		items = append(items, aoneDeviceListItem(&rows[i]))
	}

	SendJSON(ctx, map[string]any{
		"devices":     items,
		"total_count": totalCount,
		"limit":       limitOrDefault(limit),
		"offset":      maxOffset(offset),
	})
}

func (h *AoneDevicesHandler) updateDevice(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	idValue, ok := ctx.UserValue("id").(string)
	if !ok || strings.TrimSpace(idValue) == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid device id")
		return
	}
	deviceID, err := strconv.Atoi(strings.TrimSpace(idValue))
	if err != nil || deviceID <= 0 {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid device id")
		return
	}

	var payload updateAoneDeviceRequest
	if err := json.Unmarshal(ctx.PostBody(), &payload); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("Invalid request format: %v", err))
		return
	}
	if payload.IsActive == nil {
		SendError(ctx, fasthttp.StatusBadRequest, "is_active is required")
		return
	}

	reqCtx := context.Background()
	row, err := h.configStore.SetAoneDeviceAuthorizationStatus(reqCtx, deviceID, *payload.IsActive)
	if err != nil {
		if errors.Is(err, configstore.ErrDeviceAuthorizationNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "Device not found")
			return
		}
		logger.Error("[aone-devices] failed to update device id=%d: %v", deviceID, err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to update device")
		return
	}

	SendJSON(ctx, aoneDeviceDetailItem(row))
}

func aoneDeviceListItem(row *configstore.AoneDeviceAuthorizationListItem) map[string]any {
	item := aoneDeviceDetailItem(&row.AoneDeviceAuthorizationTable)
	item["user_display_name"] = row.UserDisplayName
	item["user_email"] = row.UserEmail
	return item
}

func aoneDeviceDetailItem(row *tables.AoneDeviceAuthorizationTable) map[string]any {
	return map[string]any{
		"id":                  row.ID,
		"device_fingerprint":  row.DeviceFingerprint,
		"device_name":         row.DeviceName,
		"aone_user_id":        row.AoneUserID,
		"status":              row.Status,
		"is_active":           row.Status == tables.AoneDeviceAuthorizationStatusActive,
		"last_api_access_at":  row.LastAPIAccessAt,
		"created_at":          row.CreatedAt,
		"updated_at":          row.UpdatedAt,
		"revoked_at":          row.RevokedAt,
	}
}

func (h *AoneDevicesHandler) authorize(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	reqCtx := context.Background()

	aoneUserID, ok := h.validAoneUserSessionFromRequest(reqCtx, ctx)
	if !ok {
		SendError(ctx, fasthttp.StatusUnauthorized, "Invalid or expired access token")
		return
	}

	var payload aoneDeviceAuthorizeRequest
	if err := json.Unmarshal(ctx.PostBody(), &payload); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("Invalid request format: %v", err))
		return
	}
	fingerprint := normalizeDeviceFingerprint(payload.DeviceFingerprint)
	if fingerprint == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "device_fingerprint is required")
		return
	}

	user, err := h.configStore.GetAoneUserByAoneID(reqCtx, aoneUserID)
	if err != nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "Invalid or expired access token")
		return
	}
	if user.IsDisabled {
		SendError(ctx, fasthttp.StatusForbidden, "User account is disabled")
		return
	}

	code, err := h.configStore.UpsertAoneDeviceAuthorization(reqCtx, aoneUserID, fingerprint, strings.TrimSpace(payload.DeviceName))
	if err != nil {
		logger.Error("[aone-devices] failed to authorize device for user=%s: %v", aoneUserID, err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to authorize device")
		return
	}

	SendJSON(ctx, map[string]any{
		"authorization_code": code,
	})
}

func (h *AoneDevicesHandler) token(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "Config store is not available")
		return
	}
	reqCtx := context.Background()

	var payload aoneDeviceTokenRequest
	if err := json.Unmarshal(ctx.PostBody(), &payload); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("Invalid request format: %v", err))
		return
	}
	code := strings.TrimSpace(payload.AuthorizationCode)
	fingerprint := normalizeDeviceFingerprint(payload.DeviceFingerprint)
	if code == "" || fingerprint == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "authorization_code and device_fingerprint are required")
		return
	}

	row, err := h.configStore.GetActiveAoneDeviceAuthorizationByCode(reqCtx, code)
	if err != nil {
		if errors.Is(err, configstore.ErrDeviceAuthorizationRevoked) {
			SendError(ctx, fasthttp.StatusUnauthorized, "Authorization code has been revoked")
			return
		}
		SendError(ctx, fasthttp.StatusUnauthorized, "Invalid authorization code")
		return
	}
	if row.DeviceFingerprint != fingerprint {
		SendError(ctx, fasthttp.StatusForbidden, "Device fingerprint mismatch")
		return
	}

	user, err := h.configStore.GetAoneUserByAoneID(reqCtx, row.AoneUserID)
	if err != nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "Invalid authorization code")
		return
	}
	if user.IsDisabled {
		SendError(ctx, fasthttp.StatusForbidden, "User account is disabled")
		return
	}

	// Resolve the user's internal virtual key. It is normally provisioned at
	// login; only provision here as a fallback. The temporary credential
	// resolves to this VK during forwarding — the VK is never exposed to the user.
	virtualKeyID := ""
	if user.VirtualKeyID != nil {
		virtualKeyID = strings.TrimSpace(*user.VirtualKeyID)
	}
	if virtualKeyID == "" {
		vk, ensureErr := h.configStore.EnsureAoneUserVirtualKey(reqCtx, row.AoneUserID)
		if ensureErr != nil {
			if errors.Is(ensureErr, configstore.ErrAoneUserDisabled) {
				SendError(ctx, fasthttp.StatusForbidden, "User account is disabled")
				return
			}
			logger.Error("[aone-devices] failed to ensure virtual key for user=%s: %v", row.AoneUserID, ensureErr)
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to issue credential")
			return
		}
		virtualKeyID = vk.ID
		if h.vkReloader != nil {
			if _, reloadErr := h.vkReloader.ReloadVirtualKey(reqCtx, vk.ID); reloadErr != nil {
				logger.Warn("[aone-devices] failed to reload virtual key for user=%s: %v", row.AoneUserID, reloadErr)
			} else {
				MarkAoneVirtualKeyReloaded(vk.ID)
			}
		}
	}

	credential, expiresAt, err := h.configStore.CreateAoneDeviceTemporaryCredential(
		reqCtx,
		row.AoneUserID,
		row.ID,
		fingerprint,
		virtualKeyID,
		configstore.DefaultAoneDeviceCredentialTTL,
	)
	if err != nil {
		logger.Error("[aone-devices] failed to issue temporary credential for user=%s: %v", row.AoneUserID, err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to issue credential")
		return
	}

	response := map[string]any{
		// credential is the AI-forwarding credential the client must present as
		// `Authorization: Bearer <credential>` (with its device fingerprint).
		"credential": credential,
		// access_token is kept as an alias for backward compatibility.
		"access_token": credential,
		"token_type":   "Bearer",
		"expires_in":   int(time.Until(expiresAt).Seconds()),
		"expires_at":   expiresAt,
	}
	if baseURL := deviceClientBaseURL(ctx); baseURL != "" {
		response["base_url"] = baseURL
	}

	SendJSON(ctx, response)
}

func (h *AoneDevicesHandler) revoke(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendJSON(ctx, map[string]any{"message": "revoked"})
		return
	}
	reqCtx := context.Background()

	var payload aoneDeviceRevokeRequest
	if err := json.Unmarshal(ctx.PostBody(), &payload); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("Invalid request format: %v", err))
		return
	}

	code := strings.TrimSpace(payload.AuthorizationCode)
	fingerprint := normalizeDeviceFingerprint(payload.DeviceFingerprint)
	if code == "" {
		SendJSON(ctx, map[string]any{"message": "revoked"})
		return
	}

	err := h.configStore.RevokeAoneDeviceAuthorization(reqCtx, code, fingerprint)
	if err != nil && !errors.Is(err, configstore.ErrDeviceFingerprintMismatch) {
		logger.Warn("[aone-devices] revoke failed: %v", err)
	}

	SendJSON(ctx, map[string]any{"message": "revoked"})
}

func (h *AoneDevicesHandler) validAoneUserSessionFromRequest(reqCtx context.Context, ctx *fasthttp.RequestCtx) (aoneUserID string, ok bool) {
	token := sessionTokenFromRequest(ctx)
	if token == "" {
		return "", false
	}
	session, err := h.configStore.GetSession(reqCtx, token)
	if err != nil || session == nil {
		return "", false
	}
	if session.AoneUserID == nil || strings.TrimSpace(*session.AoneUserID) == "" {
		return "", false
	}
	if session.ExpiresAt.Before(time.Now()) {
		return "", false
	}
	return strings.TrimSpace(*session.AoneUserID), true
}

func normalizeDeviceFingerprint(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 512 {
		return ""
	}
	return raw
}

func deviceClientBaseURL(ctx *fasthttp.RequestCtx) string {
	if origin := requestHostOrigin(ctx); origin != "" {
		return origin
	}
	return ""
}

// deviceForwardingPathPrefixes are the inference/forwarding route prefixes that
// are subject to device-fingerprint gating. This covers the native OpenAI-style
// routes (/v1/...) as well as every provider SDK integration prefix, so a client
// connecting directly through any of them is checked.
var deviceForwardingPathPrefixes = []string{
	"/v1/",
	"/openai/",
	"/anthropic/",
	"/genai/",
	"/bedrock/",
	"/cohere/",
	"/litellm/",
	"/langchain/",
	"/pydanticai/",
}

func isDeviceForwardingAPIPath(path string) bool {
	for _, prefix := range deviceForwardingPathPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

func recordDeviceForwardingAccessIfApplicable(store configstore.ConfigStore, sessionToken, path string) {
	if store == nil || sessionToken == "" || !isDeviceForwardingAPIPath(path) {
		return
	}
	session, err := store.GetSession(context.Background(), sessionToken)
	if err != nil || session == nil || session.DeviceAuthorizationID == nil {
		return
	}
	if strings.TrimSpace(session.LoginSource) != loginSourceZdSwitch {
		return
	}
	deviceID := *session.DeviceAuthorizationID
	go func() {
		if touchErr := store.TouchAoneDeviceAuthorizationLastAPIAccess(context.Background(), deviceID); touchErr != nil {
			logger.Warn("[aone-devices] failed to record last api access for device=%d: %v", deviceID, touchErr)
		}
	}()
}
