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

// resolveRequestAoneUserID accepts a dashboard session token or a device-issued
// temporary credential (bf-tmp-...) from Authorization Bearer or the token cookie.
func resolveRequestAoneUserID(ctx *fasthttp.RequestCtx, store configstore.ConfigStore) (string, *aoneUserAuthError) {
	if store == nil {
		return "", &aoneUserAuthError{fasthttp.StatusServiceUnavailable, "Config store is not available"}
	}

	token := strings.TrimSpace(sessionTokenFromRequest(ctx))
	if token == "" {
		return "", &aoneUserAuthError{fasthttp.StatusUnauthorized, "Authentication required"}
	}

	if strings.HasPrefix(token, configstore.AoneDeviceCredentialPrefix) {
		cred, err := store.ResolveActiveAoneDeviceTemporaryCredential(ctx, token)
		if err != nil {
			if errors.Is(err, configstore.ErrDeviceCredentialNotFound) || errors.Is(err, configstore.ErrDeviceCredentialExpired) {
				return "", &aoneUserAuthError{fasthttp.StatusUnauthorized, "Invalid or expired access token"}
			}
			logger.Error("[aone-auth] failed to resolve device credential: %v", err)
			return "", &aoneUserAuthError{fasthttp.StatusInternalServerError, "Internal Server Error"}
		}
		aoneUserID := strings.TrimSpace(cred.AoneUserID)
		if aoneUserID == "" {
			return "", &aoneUserAuthError{fasthttp.StatusUnauthorized, "Invalid or expired access token"}
		}
		return aoneUserID, nil
	}

	session, err := store.GetSession(ctx, token)
	if err != nil || session == nil {
		return "", &aoneUserAuthError{fasthttp.StatusUnauthorized, "Invalid session"}
	}
	if session.ExpiresAt.Before(time.Now()) {
		return "", &aoneUserAuthError{fasthttp.StatusUnauthorized, "Session expired"}
	}
	if session.AoneUserID == nil || strings.TrimSpace(*session.AoneUserID) == "" {
		return "", &aoneUserAuthError{fasthttp.StatusNotFound, "No Aone user linked to this session"}
	}
	return strings.TrimSpace(*session.AoneUserID), nil
}
