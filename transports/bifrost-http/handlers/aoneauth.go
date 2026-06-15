package handlers

import (
	"errors"
	"strings"
	"time"

	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/valyala/fasthttp"
)

type aoneUserAuthError struct {
	status  int
	message string
}

// resolveRequestAoneUserID accepts a global API key (bf-ak-...) assigned to a
// single user, a device-issued temporary credential (bf-tmp-...), or a
// dashboard session token from Authorization Bearer or the token cookie, and
// resolves it to the Aone user it belongs to.
func resolveRequestAoneUserID(ctx *fasthttp.RequestCtx, store configstore.ConfigStore) (string, *aoneUserAuthError) {
	userID, status, message := resolveAoneUserIDFromToken(ctx, store)
	if status != 0 {
		return "", &aoneUserAuthError{status, message}
	}
	return userID, nil
}

// resolveAoneUserIDFromToken maps an inbound credential to the Aone user it
// represents. Accepted credentials, in priority order:
//   - a global API key (bf-ak-...) assigned to a single user → that user
//   - a device-issued temporary credential (bf-tmp-...) → its bound user
//   - a dashboard session token → the Aone user linked to the session
//
// statusCode is 0 on success; otherwise it carries the HTTP status and message
// the caller should surface.
func resolveAoneUserIDFromToken(ctx *fasthttp.RequestCtx, store configstore.ConfigStore) (userID string, statusCode int, message string) {
	if store == nil {
		return "", fasthttp.StatusServiceUnavailable, "Config store is not available"
	}

	token := strings.TrimSpace(sessionTokenFromRequest(ctx))
	if token == "" {
		return "", fasthttp.StatusUnauthorized, "Authentication required"
	}

	// A global API key assigned to an individual authenticates that user, so the
	// user can call these endpoints directly with their assigned key instead of
	// going through the device temporary credential flow.
	if strings.HasPrefix(token, configstore.GlobalAPIKeyPrefix) {
		key, err := store.GetActiveGlobalAPIKeyByToken(ctx, token)
		if err != nil {
			logger.Error("[aone-auth] failed to resolve global api key: %v", err)
			return "", fasthttp.StatusInternalServerError, "Internal Server Error"
		}
		if key == nil {
			return "", fasthttp.StatusUnauthorized, "Invalid or expired access token"
		}
		assignedUserID := configstore.GlobalAPIKeyAssignedUserID(*key)
		if assignedUserID == "" {
			return "", fasthttp.StatusForbidden, "Global API key is not assigned to a user"
		}
		return assignedUserID, 0, ""
	}

	if strings.HasPrefix(token, configstore.AoneDeviceCredentialPrefix) {
		cred, err := store.ResolveActiveAoneDeviceTemporaryCredential(ctx, token)
		if err != nil {
			if errors.Is(err, configstore.ErrDeviceCredentialNotFound) || errors.Is(err, configstore.ErrDeviceCredentialExpired) {
				return "", fasthttp.StatusUnauthorized, "Invalid or expired access token"
			}
			logger.Error("[aone-auth] failed to resolve device credential: %v", err)
			return "", fasthttp.StatusInternalServerError, "Internal Server Error"
		}
		aoneUserID := strings.TrimSpace(cred.AoneUserID)
		if aoneUserID == "" {
			return "", fasthttp.StatusUnauthorized, "Invalid or expired access token"
		}
		return aoneUserID, 0, ""
	}

	session, err := store.GetSession(ctx, token)
	if err != nil || session == nil {
		return "", fasthttp.StatusUnauthorized, "Invalid session"
	}
	if session.ExpiresAt.Before(time.Now()) {
		return "", fasthttp.StatusUnauthorized, "Session expired"
	}
	if session.AoneUserID == nil || strings.TrimSpace(*session.AoneUserID) == "" {
		return "", fasthttp.StatusNotFound, "No Aone user linked to this session"
	}
	return strings.TrimSpace(*session.AoneUserID), 0, ""
}
