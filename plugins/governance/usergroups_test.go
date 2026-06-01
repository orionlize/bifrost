package governance

import (
	"context"
	"testing"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/assert"
)

// newTestUserGroupManager builds a manager with no config store (pure in-memory)
// and seeds a single group with a short token window and two tiers.
func newTestUserGroupManager(t *testing.T) (*UserGroupManager, *configstoreTables.TableUserGroup) {
	t.Helper()
	m := NewUserGroupManager(nil, NewMockLogger())

	group := &configstoreTables.TableUserGroup{
		ID:                       "grp-1",
		Name:                     "high-consumption",
		Enabled:                  bifrost.Ptr(true),
		ShortWindowTokenLimit:    bifrost.Ptr(int64(1000)),
		ShortWindowResetDuration: bifrost.Ptr("5h"),
		Tiers: []configstoreTables.TableUserGroupTier{
			{
				ID:           "tier-1",
				UserGroupID:  "grp-1",
				TierOrder:    1,
				ThresholdPct: 60,
				Mappings: []configstoreTables.TableUserGroupTierMapping{
					{ID: "m1", TierID: "tier-1", SourceModel: "gpt-5.5", TargetModel: "gpt-5-mini"},
				},
			},
			{
				ID:              "tier-2",
				UserGroupID:     "grp-1",
				TierOrder:       2,
				ThresholdPct:    90,
				IsTerminal:      true,
				ParsedFallbacks: []string{"groq/llama-3.1-8b"},
				Mappings: []configstoreTables.TableUserGroupTierMapping{
					{ID: "m2", TierID: "tier-2", SourceModel: "*", TargetModel: "gpt-5-nano"},
				},
			},
		},
	}

	m.groups["grp-1"] = group
	m.vkToGroups["vk-1"] = []string{"grp-1"}
	return m, group
}

func TestUserGroupNoDegradationBelowThreshold(t *testing.T) {
	m, _ := newTestUserGroupManager(t)
	// 50% usage — below tier 1 threshold (60%).
	m.RecordUsage("vk-1", "vk-1", 500)
	res := m.ResolveDegradation("vk-1", "vk-1", "openai", "gpt-5.5", "")
	assert.Nil(t, res, "no tier should be active below the first threshold")
}

func TestUserGroupTier1Substitution(t *testing.T) {
	m, _ := newTestUserGroupManager(t)
	// 70% usage — tier 1 active (>=60%, <90%).
	m.RecordUsage("vk-1", "vk-1", 700)
	res := m.ResolveDegradation("vk-1", "vk-1", "openai", "gpt-5.5", "")
	assert.NotNil(t, res)
	assert.True(t, res.Changed)
	assert.Equal(t, "gpt-5-mini", res.Model)
	assert.Equal(t, 1, res.TierOrder)
	assert.Empty(t, res.Fallbacks, "non-terminal tier should not attach fallbacks")
}

func TestUserGroupTerminalTierWildcardAndFallbacks(t *testing.T) {
	m, _ := newTestUserGroupManager(t)
	// 95% usage — terminal tier 2 active (>=90%).
	m.RecordUsage("vk-1", "vk-1", 950)
	res := m.ResolveDegradation("vk-1", "vk-1", "anthropic", "claude-opus", "")
	assert.NotNil(t, res)
	assert.True(t, res.Changed)
	assert.Equal(t, "gpt-5-nano", res.Model, "wildcard mapping should match any model")
	assert.Equal(t, 2, res.TierOrder)
	assert.Equal(t, []string{"groq/llama-3.1-8b"}, res.Fallbacks)
}

func TestUserGroupLoadExpiresStaleUsageFromDB(t *testing.T) {
	m, group := newTestUserGroupManager(t)
	key := usageKey("vk-1", group.ID, configstoreTables.UserGroupWindowShort)
	m.usageMu.Lock()
	m.usage[key] = &userGroupCounter{
		tokens:    7_400_000,
		lastReset: time.Now().Add(-6 * time.Hour),
	}
	m.usageMu.Unlock()

	// Simulate a reload that would hydrate from a stale DB row.
	m.usageMu.Lock()
	c := m.usage[key]
	m.resetCounterIfExpired(c, group, "5h", time.Now())
	m.usageMu.Unlock()

	assert.Equal(t, int64(0), m.effectiveTokens("vk-1", group, configstoreTables.UserGroupWindowShort, "5h", time.Now()))
}

func TestUserGroupWindowResetRecovers(t *testing.T) {
	m, group := newTestUserGroupManager(t)
	m.RecordUsage("vk-1", "vk-1", 950) // 95% -> terminal tier
	assert.NotNil(t, m.ResolveDegradation("vk-1", "vk-1", "openai", "gpt-5.5", ""))

	// Simulate the window elapsing by backdating the counter's last reset.
	key := usageKey("vk-1", group.ID, configstoreTables.UserGroupWindowShort)
	m.usageMu.Lock()
	m.usage[key].lastReset = time.Now().Add(-6 * time.Hour)
	m.usageMu.Unlock()

	// After the window expires, usage is treated as zero -> no degradation.
	res := m.ResolveDegradation("vk-1", "vk-1", "openai", "gpt-5.5", "")
	assert.Nil(t, res, "degradation should de-escalate after the window resets")
}

func TestUserGroupProviderScopedMappingDoesNotMatchOtherProvider(t *testing.T) {
	m := NewUserGroupManager(nil, NewMockLogger())
	m.groups["g"] = &configstoreTables.TableUserGroup{
		ID:                       "g",
		Name:                     "g",
		Enabled:                  bifrost.Ptr(true),
		ShortWindowTokenLimit:    bifrost.Ptr(int64(100)),
		ShortWindowResetDuration: bifrost.Ptr("5h"),
		Tiers: []configstoreTables.TableUserGroupTier{
			{
				ID: "t", UserGroupID: "g", TierOrder: 1, ThresholdPct: 50,
				Mappings: []configstoreTables.TableUserGroupTierMapping{
					{ID: "mm", TierID: "t", SourceProvider: bifrost.Ptr("openai"), SourceModel: "gpt-5.5", TargetModel: "gpt-5-mini"},
				},
			},
		},
	}
	m.vkToGroups["vk"] = []string{"g"}
	m.RecordUsage("vk", "vk", 80) // 80% -> tier active

	// Different provider: mapping is scoped to openai, so no substitution.
	res := m.ResolveDegradation("vk", "vk", "anthropic", "gpt-5.5", "")
	assert.Nil(t, res)

	// Matching provider: substitution applies.
	res = m.ResolveDegradation("vk", "vk", "openai", "gpt-5.5", "")
	assert.NotNil(t, res)
	assert.Equal(t, "gpt-5-mini", res.Model)
}

func TestUserGroupSourceKeyScopedMapping(t *testing.T) {
	m := NewUserGroupManager(nil, NewMockLogger())
	sourceKey := "key-premium"
	targetKey := "key-cheap"
	m.groups["g"] = &configstoreTables.TableUserGroup{
		ID:                       "g",
		Name:                     "g",
		Enabled:                  bifrost.Ptr(true),
		ShortWindowTokenLimit:    bifrost.Ptr(int64(100)),
		ShortWindowResetDuration: bifrost.Ptr("5h"),
		Tiers: []configstoreTables.TableUserGroupTier{
			{
				ID: "t", UserGroupID: "g", TierOrder: 1, ThresholdPct: 50,
				Mappings: []configstoreTables.TableUserGroupTierMapping{
					{
						ID: "mm", TierID: "t",
						SourceProvider: bifrost.Ptr("openai"),
						SourceKeyID:    bifrost.Ptr(sourceKey),
						SourceModel:    "gpt-5.5",
						TargetModel:    "gpt-5-mini",
						TargetKeyID:    bifrost.Ptr(targetKey),
					},
				},
			},
		},
	}
	m.vkToGroups["vk"] = []string{"g"}
	m.RecordUsage("vk", "vk", 80)

	// Wrong key: mapping should not match when the request pins a different key.
	res := m.ResolveDegradation("vk", "vk", "openai", "gpt-5.5", "other-key")
	assert.Nil(t, res)

	// No explicit key pin: source_key_id is ignored and provider/model still match.
	res = m.ResolveDegradation("vk", "vk", "openai", "gpt-5.5", "")
	assert.NotNil(t, res)
	assert.Equal(t, "gpt-5-mini", res.Model)
	assert.Equal(t, targetKey, res.KeyID)

	// Matching source key: substitution + target key pin.
	res = m.ResolveDegradation("vk", "vk", "openai", "gpt-5.5", sourceKey)
	assert.NotNil(t, res)
	assert.True(t, res.Changed)
	assert.Equal(t, "gpt-5-mini", res.Model)
	assert.Equal(t, targetKey, res.KeyID)
}

func TestUserGroupTargetKeyPinWithoutModelChange(t *testing.T) {
	m := NewUserGroupManager(nil, NewMockLogger())
	sourceKey := "key-a"
	targetKey := "key-b"
	m.groups["g"] = &configstoreTables.TableUserGroup{
		ID:                       "g",
		Name:                     "g",
		Enabled:                  bifrost.Ptr(true),
		ShortWindowTokenLimit:    bifrost.Ptr(int64(100)),
		ShortWindowResetDuration: bifrost.Ptr("5h"),
		Tiers: []configstoreTables.TableUserGroupTier{
			{
				ID: "t", UserGroupID: "g", TierOrder: 1, ThresholdPct: 50,
				Mappings: []configstoreTables.TableUserGroupTierMapping{
					{
						ID: "mm", TierID: "t",
						SourceProvider: bifrost.Ptr("openai"),
						SourceKeyID:    bifrost.Ptr(sourceKey),
						SourceModel:    "gpt-5.5",
						TargetModel:    "gpt-5.5",
						TargetKeyID:    bifrost.Ptr(targetKey),
					},
				},
			},
		},
	}
	m.vkToGroups["vk"] = []string{"g"}
	m.RecordUsage("vk", "vk", 80)

	res := m.ResolveDegradation("vk", "vk", "openai", "gpt-5.5", sourceKey)
	assert.NotNil(t, res)
	assert.True(t, res.Changed)
	assert.Equal(t, targetKey, res.KeyID)
	assert.Equal(t, "gpt-5.5", res.Model)
}

func TestReconcileTokenUsage(t *testing.T) {
	assert.Equal(t, int64(950), ReconcileTokenUsage(950, 0))
	assert.Equal(t, int64(5000), ReconcileTokenUsage(950, 5000))
	assert.Equal(t, int64(700), ReconcileTokenUsage(700, 700))
}

func TestGroupMemberUsageReturnsLiveCounters(t *testing.T) {
	m, group := newTestUserGroupManager(t)
	m.RecordUsage("vk-1", "vk-1", 700)

	usage := m.GroupMemberUsage(group.ID)
	assert.Len(t, usage, 1)
	assert.Len(t, usage[0].Windows, 1)
	assert.Equal(t, int64(700), usage[0].Windows[0].TokenUsed)
	assert.InDelta(t, 70, usage[0].Windows[0].PercentUsed, 0.001)
}

func TestLogUsageRangeStart(t *testing.T) {
	windowStart := time.Now().Add(-5 * time.Hour)
	lastReset := time.Now().Add(-1 * time.Hour)
	assert.Equal(t, lastReset, LogUsageRangeStart(windowStart, &lastReset))
	assert.Equal(t, windowStart, LogUsageRangeStart(windowStart, nil))
	older := windowStart.Add(-time.Hour)
	assert.Equal(t, windowStart, LogUsageRangeStart(windowStart, &older))
}

func TestShouldUseGovernanceCounterForDisplay(t *testing.T) {
	windowStart := time.Now().Add(-7 * 24 * time.Hour)
	manualReset := time.Now()
	assert.True(t, ShouldUseGovernanceCounterForDisplay(windowStart, &manualReset))

	midWindow := windowStart.Add(24 * time.Hour)
	assert.True(t, ShouldUseGovernanceCounterForDisplay(windowStart, &midWindow))

	periodStart := windowStart
	assert.True(t, ShouldUseGovernanceCounterForDisplay(windowStart, &periodStart))
	assert.False(t, ShouldUseGovernanceCounterForDisplay(windowStart, nil))
}

func TestResetMemberUsageClearsBothWindows(t *testing.T) {
	m, group := newTestUserGroupManager(t)
	group.WeeklyWindowTokenLimit = bifrost.Ptr(int64(5000))
	group.WeeklyWindowResetDuration = bifrost.Ptr("1w")
	m.RecordUsage("vk-1", "vk-1", 700)

	err := m.ResetMemberUsage(context.Background(), group.ID, "vk-1")
	assert.NoError(t, err)

	usage := m.GroupMemberUsage(group.ID)
	assert.Len(t, usage, 1)
	assert.Len(t, usage[0].Windows, 2)

	windows := map[string]int64{}
	for _, w := range usage[0].Windows {
		windows[w.Window] = w.TokenUsed
		assert.NotNil(t, w.LastReset)
		assert.WithinDuration(t, time.Now(), *w.LastReset, 2*time.Second)
	}
	assert.Equal(t, int64(0), windows[configstoreTables.UserGroupWindowShort])
	assert.Equal(t, int64(0), windows[configstoreTables.UserGroupWindowWeekly])
	assert.Equal(t, float64(0), usage[0].UsagePercent)
	assert.Nil(t, usage[0].ActiveTierOrder)
}

func TestResetMemberUsageRejectsUnknownMember(t *testing.T) {
	m, group := newTestUserGroupManager(t)
	err := m.ResetMemberUsage(context.Background(), group.ID, "missing-vk")
	assert.ErrorIs(t, err, ErrUserGroupMemberNotFound)
}
