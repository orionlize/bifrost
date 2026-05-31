package logging

import (
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/logstore"
)

func (p *LoggerPlugin) incrementalContentLoggingEnabled() bool {
	if p.incrementalContentLogging != nil && !*p.incrementalContentLogging {
		return false
	}
	return true
}

func resolveSessionID(ctx *schemas.BifrostContext, entry *logstore.Log) string {
	if entry != nil && entry.ParentRequestID != nil {
		if sessionID := strings.TrimSpace(*entry.ParentRequestID); sessionID != "" {
			return sessionID
		}
	}
	if ctx == nil {
		return ""
	}
	if sessionID := strings.TrimSpace(bifrostGetString(ctx, schemas.BifrostContextKeyParentRequestID)); sessionID != "" {
		return sessionID
	}
	if sessionID := strings.TrimSpace(bifrostGetString(ctx, schemas.BifrostContextKeySessionID)); sessionID != "" {
		return sessionID
	}
	return strings.TrimSpace(bifrostGetString(ctx, schemas.BifrostContextKeyRealtimeSessionID))
}

func bifrostGetString(ctx *schemas.BifrostContext, key schemas.BifrostContextKey) string {
	if ctx == nil {
		return ""
	}
	value, _ := ctx.Value(key).(string)
	return value
}

func ensureSessionParentLink(ctx *schemas.BifrostContext, entry *logstore.Log) {
	sessionID := resolveSessionID(ctx, entry)
	if sessionID == "" {
		return
	}
	if entry.ParentRequestID == nil || strings.TrimSpace(*entry.ParentRequestID) == "" {
		entry.ParentRequestID = &sessionID
	}
}

func (p *LoggerPlugin) applyIncrementalInputStorage(ctx *schemas.BifrostContext, entry *logstore.Log) {
	if !p.incrementalContentLoggingEnabled() || entry == nil || !p.contentLoggingEnabled(ctx) {
		return
	}
	if !logstore.SupportsIncrementalInput(entry.Object) {
		return
	}

	ensureSessionParentLink(ctx, entry)
	sessionID := logstore.SessionIDForLog(entry)
	if sessionID == "" {
		return
	}

	entry.ContentSummary = entry.BuildContentSummary()

	prevChatCount, prevResponsesCount, err := p.store.GetLatestSessionConversationCounts(p.ctx, sessionID)
	if err != nil {
		p.logger.Warn("incremental log storage: failed to read session counts for %s: %v", sessionID, err)
		return
	}
	logstore.ApplyIncrementalInputStorage(entry, prevChatCount, prevResponsesCount)
}

func (p *LoggerPlugin) hydrateLogInputHistory(entry *logstore.Log) {
	if entry == nil || !logstore.NeedsInputHydration(entry) {
		return
	}
	sessionID := logstore.SessionIDForLog(entry)
	if sessionID == "" {
		return
	}

	sessionLogs, err := p.store.GetSessionLogsForInputHydration(p.ctx, logstore.SessionAnchor{
		SessionID: sessionID,
		Timestamp: entry.Timestamp,
		LogID:     entry.ID,
	})
	if err != nil {
		p.logger.Warn("incremental log hydration: failed to load session logs for %s: %v", sessionID, err)
		return
	}

	prior := make([]*logstore.Log, 0, len(sessionLogs))
	for _, sessionLog := range sessionLogs {
		if sessionLog == nil || sessionLog.ID == entry.ID {
			continue
		}
		prior = append(prior, sessionLog)
	}
	logstore.HydrateLogInputHistory(entry, prior)
}
