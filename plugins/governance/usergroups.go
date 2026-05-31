// Package governance: tiered, group-based model degradation.
//
// A user group is a customizable tag attached to a set of virtual keys. Each group
// carries two token windows (a short rolling window such as "5h" and a weekly window)
// plus an ordered list of degradation tiers. Per-user token consumption is tracked
// against both windows; as consumption climbs, progressively more aggressive tiers
// activate and rewrite high-cost models to cheaper ones. When the windows reset,
// consumption falls and the active tier de-escalates automatically.
//
// The manager is intentionally decoupled from the large GovernanceStore interface:
// it reads/writes its own tables directly via configstore.ScopedDB and keeps an
// in-memory cache plus per-user counters for fast, lock-free-ish hot-path access.
package governance

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// userGroupCounter is an in-memory token counter for one (identity, group, window) triple.
type userGroupCounter struct {
	tokens    int64
	lastReset time.Time
	dirty     bool // true when the counter changed since the last DB dump
}

// DegradationResult describes the model substitution chosen for a request.
type DegradationResult struct {
	Provider  string   // target provider ("" = keep incoming)
	Model     string   // target model ("" = keep incoming)
	Fallbacks []string // cross-model fallbacks ("provider/model"), terminal tiers only
	GroupName string
	GroupID   string
	TierOrder int
	Changed   bool // true when provider/model differs from the incoming request
}

// UserGroupManager owns the user-group cache and per-user window usage counters.
type UserGroupManager struct {
	configStore configstore.ConfigStore
	logger      schemas.Logger

	mu         sync.RWMutex
	groups     map[string]*configstoreTables.TableUserGroup // groupID -> group (tiers preloaded, sorted)
	vkToGroups map[string][]string                          // virtualKeyID -> []groupID

	usageMu sync.Mutex
	usage   map[string]*userGroupCounter // key: usageKey(identity, groupID, window)
}

// NewUserGroupManager constructs a manager. configStore may be nil (no persistence),
// in which case the manager is a no-op.
func NewUserGroupManager(configStore configstore.ConfigStore, logger schemas.Logger) *UserGroupManager {
	return &UserGroupManager{
		configStore: configStore,
		logger:      logger,
		groups:      make(map[string]*configstoreTables.TableUserGroup),
		vkToGroups:  make(map[string][]string),
		usage:       make(map[string]*userGroupCounter),
	}
}

func usageKey(identity, groupID, window string) string {
	return identity + "\x00" + groupID + "\x00" + window
}

// Load (re)builds the in-memory group cache and membership index from the database,
// and seeds usage counters from persisted rows. Safe to call repeatedly (config reload).
func (m *UserGroupManager) Load(ctx context.Context) error {
	if m == nil || m.configStore == nil {
		return nil
	}
	db := m.configStore.ScopedDB(ctx)

	var groups []configstoreTables.TableUserGroup
	if err := db.
		Preload("Tiers", func(tx *gorm.DB) *gorm.DB { return tx.Order("tier_order ASC") }).
		Preload("Tiers.Mappings").
		Find(&groups).Error; err != nil {
		return err
	}

	var members []configstoreTables.TableUserGroupMember
	if err := db.Find(&members).Error; err != nil {
		return err
	}

	var usageRows []configstoreTables.TableUserGroupUsage
	if err := db.Find(&usageRows).Error; err != nil {
		return err
	}

	groupMap := make(map[string]*configstoreTables.TableUserGroup, len(groups))
	for i := range groups {
		g := &groups[i]
		// Keep tiers sorted by threshold ascending for active-tier selection.
		sort.SliceStable(g.Tiers, func(a, b int) bool {
			if g.Tiers[a].ThresholdPct == g.Tiers[b].ThresholdPct {
				return g.Tiers[a].TierOrder < g.Tiers[b].TierOrder
			}
			return g.Tiers[a].ThresholdPct < g.Tiers[b].ThresholdPct
		})
		groupMap[g.ID] = g
	}

	vkToGroups := make(map[string][]string)
	for _, mem := range members {
		if _, ok := groupMap[mem.UserGroupID]; !ok {
			continue
		}
		vkToGroups[mem.VirtualKeyID] = append(vkToGroups[mem.VirtualKeyID], mem.UserGroupID)
	}

	m.mu.Lock()
	m.groups = groupMap
	m.vkToGroups = vkToGroups
	m.mu.Unlock()

	// Seed counters (preserve any newer in-memory deltas not yet dumped).
	m.usageMu.Lock()
	for i := range usageRows {
		row := usageRows[i]
		key := usageKey(row.Identity, row.UserGroupID, row.Window)
		if existing, ok := m.usage[key]; ok && existing.dirty {
			continue
		}
		m.usage[key] = &userGroupCounter{tokens: row.TokenCurrentUsage, lastReset: row.TokenLastReset}
	}
	m.usageMu.Unlock()

	return nil
}

// HasGroups reports whether any enabled user group is configured.
func (m *UserGroupManager) HasGroups() bool {
	if m == nil {
		return false
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, g := range m.groups {
		if g.EnabledValue() {
			return true
		}
	}
	return false
}

// windowConfig returns the token limit and reset duration for a group window.
func windowConfig(g *configstoreTables.TableUserGroup, window string) (*int64, *string) {
	switch window {
	case configstoreTables.UserGroupWindowShort:
		return g.ShortWindowTokenLimit, g.ShortWindowResetDuration
	case configstoreTables.UserGroupWindowWeekly:
		return g.WeeklyWindowTokenLimit, g.WeeklyWindowResetDuration
	default:
		return nil, nil
	}
}

// isWindowExpired reports whether a counter's window has elapsed at time now.
func isWindowExpired(lastReset time.Time, resetDuration string, calendarAligned bool, now time.Time) bool {
	d, err := configstoreTables.ParseDuration(resetDuration)
	if err != nil || d <= 0 {
		return false
	}
	if calendarAligned && configstoreTables.IsCalendarAlignableDuration(resetDuration) {
		return lastReset.Before(configstoreTables.GetCalendarPeriodStart(resetDuration, now))
	}
	return now.Sub(lastReset) >= d
}

// effectiveTokens returns the live token count for a window, treating an expired
// window as zero (grace handling, mirrors the rate-limit reset semantics).
func (m *UserGroupManager) effectiveTokens(identity string, g *configstoreTables.TableUserGroup, window, resetDuration string, now time.Time) int64 {
	m.usageMu.Lock()
	defer m.usageMu.Unlock()
	c, ok := m.usage[usageKey(identity, g.ID, window)]
	if !ok {
		return 0
	}
	if isWindowExpired(c.lastReset, resetDuration, g.CalendarAligned, now) {
		return 0
	}
	return c.tokens
}

// usagePercent returns the group's current window usage percentage for an identity,
// taken as the maximum across the configured windows (so the short and weekly
// windows are evaluated jointly).
func (m *UserGroupManager) usagePercent(identity string, g *configstoreTables.TableUserGroup, now time.Time) float64 {
	var pct float64
	for _, window := range []string{configstoreTables.UserGroupWindowShort, configstoreTables.UserGroupWindowWeekly} {
		limit, dur := windowConfig(g, window)
		if limit == nil || *limit <= 0 || dur == nil {
			continue
		}
		used := m.effectiveTokens(identity, g, window, *dur, now)
		p := float64(used) / float64(*limit) * 100
		if p > pct {
			pct = p
		}
	}
	return pct
}

// activeTierForGroup returns the highest-threshold tier whose ThresholdPct is met by
// the current usage percentage, or nil if no tier is active.
func activeTierForGroup(g *configstoreTables.TableUserGroup, pct float64) *configstoreTables.TableUserGroupTier {
	var active *configstoreTables.TableUserGroupTier
	for i := range g.Tiers {
		t := &g.Tiers[i]
		if pct >= t.ThresholdPct {
			active = t // tiers are sorted ascending by threshold; last match wins
		}
	}
	return active
}

// ResolveDegradation determines the model substitution (if any) for a request from a
// caller identified by identity (user ID or VK ID) holding virtual key vkID. It selects
// the most aggressive active tier across all of the VK's groups and applies its mapping.
func (m *UserGroupManager) ResolveDegradation(identity, vkID, provider, model string) *DegradationResult {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	groupIDs := append([]string(nil), m.vkToGroups[vkID]...)
	groups := make([]*configstoreTables.TableUserGroup, 0, len(groupIDs))
	for _, id := range groupIDs {
		if g, ok := m.groups[id]; ok && g.EnabledValue() {
			groups = append(groups, g)
		}
	}
	m.mu.RUnlock()
	if len(groups) == 0 {
		return nil
	}

	now := time.Now()

	// Pick the most aggressive active tier across all groups: highest threshold,
	// tie-break on terminal then tier order.
	var bestTier *configstoreTables.TableUserGroupTier
	var bestGroup *configstoreTables.TableUserGroup
	for _, g := range groups {
		pct := m.usagePercent(identity, g, now)
		t := activeTierForGroup(g, pct)
		if m.logger != nil {
			if t == nil {
				m.logger.Debug("[UserGroups] identity=%s group=%s usage=%.1f%% -> no active tier", identity, g.Name, pct)
			} else {
				m.logger.Debug("[UserGroups] identity=%s group=%s usage=%.1f%% -> tier %d (threshold %.1f%%)", identity, g.Name, pct, t.TierOrder, t.ThresholdPct)
			}
		}
		if t == nil {
			continue
		}
		if bestTier == nil || moreAggressive(t, bestTier) {
			bestTier = t
			bestGroup = g
		}
	}
	if bestTier == nil {
		return nil
	}

	res := &DegradationResult{
		GroupName: bestGroup.Name,
		GroupID:   bestGroup.ID,
		TierOrder: bestTier.TierOrder,
	}

	if tp, tm, matched := matchMapping(bestTier, provider, model); matched {
		res.Provider = tp
		res.Model = tm
		res.Changed = !strings.EqualFold(tm, model) || (tp != "" && !strings.EqualFold(tp, provider))
	}

	// Terminal tiers attach cross-model fallbacks regardless of mapping match.
	if bestTier.IsTerminal && len(bestTier.ParsedFallbacks) > 0 {
		res.Fallbacks = append(res.Fallbacks, bestTier.ParsedFallbacks...)
	}

	if !res.Changed && len(res.Fallbacks) == 0 {
		return nil
	}
	return res
}

// moreAggressive reports whether tier a is more aggressive than tier b.
func moreAggressive(a, b *configstoreTables.TableUserGroupTier) bool {
	if a.ThresholdPct != b.ThresholdPct {
		return a.ThresholdPct > b.ThresholdPct
	}
	if a.IsTerminal != b.IsTerminal {
		return a.IsTerminal
	}
	return a.TierOrder > b.TierOrder
}

// matchMapping finds the substitution target for the given provider/model in a tier.
// Exact (model + optional provider) matches win over wildcard ("*") matches.
func matchMapping(tier *configstoreTables.TableUserGroupTier, provider, model string) (targetProvider, targetModel string, matched bool) {
	var wildcard *configstoreTables.TableUserGroupTierMapping
	for i := range tier.Mappings {
		mp := &tier.Mappings[i]
		if mp.SourceProvider != nil && *mp.SourceProvider != "" && !strings.EqualFold(*mp.SourceProvider, provider) {
			continue
		}
		if mp.SourceModel == "*" {
			if wildcard == nil {
				wildcard = mp
			}
			continue
		}
		if strings.EqualFold(mp.SourceModel, model) {
			tp := ""
			if mp.TargetProvider != nil {
				tp = *mp.TargetProvider
			}
			return tp, mp.TargetModel, true
		}
	}
	if wildcard != nil {
		tp := ""
		if wildcard.TargetProvider != nil {
			tp = *wildcard.TargetProvider
		}
		return tp, wildcard.TargetModel, true
	}
	return "", "", false
}

// UserGroupWindowStatus is the live usage of one window for one member.
type UserGroupWindowStatus struct {
	Window        string     `json:"window"`
	TokenLimit    *int64     `json:"token_limit,omitempty"`
	TokenUsed     int64      `json:"token_used"`
	PercentUsed   float64    `json:"percent_used"`
	ResetDuration *string    `json:"reset_duration,omitempty"`
	LastReset     *time.Time `json:"last_reset,omitempty"`
}

// UserGroupMemberUsage is the live window usage + active degradation tier for one
// member (virtual key) of a group.
type UserGroupMemberUsage struct {
	Identity            string                  `json:"identity"` // virtual key ID
	UsagePercent        float64                 `json:"usage_percent"`
	Windows             []UserGroupWindowStatus `json:"windows"`
	ActiveTierOrder     *int                    `json:"active_tier_order,omitempty"`
	ActiveTierThreshold *float64                `json:"active_tier_threshold_pct,omitempty"`
	ActiveTierTerminal  bool                    `json:"active_tier_is_terminal"`
}

// GroupMemberUsage returns the live window usage and active tier for every member
// (virtual key) of a group, computed from the in-memory counters that actually
// drive degradation decisions.
func (m *UserGroupManager) GroupMemberUsage(groupID string) []UserGroupMemberUsage {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	g, ok := m.groups[groupID]
	var memberVKs []string
	if ok {
		for vkID, gids := range m.vkToGroups {
			for _, gid := range gids {
				if gid == groupID {
					memberVKs = append(memberVKs, vkID)
					break
				}
			}
		}
	}
	m.mu.RUnlock()
	if !ok {
		return nil
	}

	now := time.Now()
	sort.Strings(memberVKs)
	out := make([]UserGroupMemberUsage, 0, len(memberVKs))
	for _, vkID := range memberVKs {
		status := UserGroupMemberUsage{Identity: vkID}
		for _, window := range []string{configstoreTables.UserGroupWindowShort, configstoreTables.UserGroupWindowWeekly} {
			limit, dur := windowConfig(g, window)
			if limit == nil || dur == nil {
				continue
			}
			var used int64
			var lastReset *time.Time
			m.usageMu.Lock()
			if c, present := m.usage[usageKey(vkID, g.ID, window)]; present {
				lr := c.lastReset
				lastReset = &lr
				if !isWindowExpired(c.lastReset, *dur, g.CalendarAligned, now) {
					used = c.tokens
				}
			}
			m.usageMu.Unlock()

			pct := 0.0
			if *limit > 0 {
				pct = float64(used) / float64(*limit) * 100
			}
			status.Windows = append(status.Windows, UserGroupWindowStatus{
				Window:        window,
				TokenLimit:    limit,
				TokenUsed:     used,
				PercentUsed:   pct,
				ResetDuration: dur,
				LastReset:     lastReset,
			})
			if pct > status.UsagePercent {
				status.UsagePercent = pct
			}
		}
		if t := activeTierForGroup(g, status.UsagePercent); t != nil {
			order := t.TierOrder
			threshold := t.ThresholdPct
			status.ActiveTierOrder = &order
			status.ActiveTierThreshold = &threshold
			status.ActiveTierTerminal = t.IsTerminal
		}
		out = append(out, status)
	}
	return out
}

// RecordUsage adds tokens to every window counter for each group the VK belongs to.
func (m *UserGroupManager) RecordUsage(identity, vkID string, tokens int64) {
	if m == nil || tokens <= 0 || identity == "" {
		return
	}
	m.mu.RLock()
	groupIDs := append([]string(nil), m.vkToGroups[vkID]...)
	groups := make([]*configstoreTables.TableUserGroup, 0, len(groupIDs))
	for _, id := range groupIDs {
		if g, ok := m.groups[id]; ok && g.EnabledValue() {
			groups = append(groups, g)
		}
	}
	m.mu.RUnlock()
	if len(groups) == 0 {
		return
	}

	now := time.Now()
	m.usageMu.Lock()
	defer m.usageMu.Unlock()
	for _, g := range groups {
		for _, window := range []string{configstoreTables.UserGroupWindowShort, configstoreTables.UserGroupWindowWeekly} {
			limit, dur := windowConfig(g, window)
			if limit == nil || dur == nil {
				continue
			}
			key := usageKey(identity, g.ID, window)
			c, ok := m.usage[key]
			if !ok {
				c = &userGroupCounter{lastReset: now}
				m.usage[key] = c
			}
			// Lazily reset an expired window before accumulating.
			if isWindowExpired(c.lastReset, *dur, g.CalendarAligned, now) {
				c.tokens = 0
				c.lastReset = m.resetBaseline(g, *dur, now)
			}
			c.tokens += tokens
			c.dirty = true
		}
	}
}

// resetBaseline returns the new last-reset timestamp for a window after a reset.
func (m *UserGroupManager) resetBaseline(g *configstoreTables.TableUserGroup, resetDuration string, now time.Time) time.Time {
	if g.CalendarAligned && configstoreTables.IsCalendarAlignableDuration(resetDuration) {
		return configstoreTables.GetCalendarPeriodStart(resetDuration, now)
	}
	return now
}

// Tick resets expired window counters and dumps dirty counters to the database.
// Intended to be called periodically by the usage tracker's reset worker.
func (m *UserGroupManager) Tick(ctx context.Context) {
	if m == nil || m.configStore == nil {
		return
	}

	// Snapshot group windows for reset evaluation.
	m.mu.RLock()
	groups := make(map[string]*configstoreTables.TableUserGroup, len(m.groups))
	for id, g := range m.groups {
		groups[id] = g
	}
	m.mu.RUnlock()

	now := time.Now()
	var toPersist []configstoreTables.TableUserGroupUsage

	m.usageMu.Lock()
	for key, c := range m.usage {
		parts := strings.Split(key, "\x00")
		if len(parts) != 3 {
			continue
		}
		identity, groupID, window := parts[0], parts[1], parts[2]
		g, ok := groups[groupID]
		if !ok {
			// Group deleted — drop the orphan counter.
			delete(m.usage, key)
			continue
		}
		_, dur := windowConfig(g, window)
		if dur != nil && isWindowExpired(c.lastReset, *dur, g.CalendarAligned, now) {
			c.tokens = 0
			c.lastReset = m.resetBaseline(g, *dur, now)
			c.dirty = true
		}
		if c.dirty {
			toPersist = append(toPersist, configstoreTables.TableUserGroupUsage{
				ID:                uuid.NewString(),
				Identity:          identity,
				UserGroupID:       groupID,
				Window:            window,
				TokenCurrentUsage: c.tokens,
				TokenLastReset:    c.lastReset,
				UpdatedAt:         now,
			})
			c.dirty = false
		}
	}
	m.usageMu.Unlock()

	if len(toPersist) == 0 {
		return
	}

	db := m.configStore.ScopedDB(ctx)
	if err := db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "identity"}, {Name: "user_group_id"}, {Name: "window"}},
		DoUpdates: clause.AssignmentColumns([]string{"token_current_usage", "token_last_reset", "updated_at"}),
	}).Create(&toPersist).Error; err != nil {
		m.logger.Error("failed to persist user group usage: %v", err)
	}
}
