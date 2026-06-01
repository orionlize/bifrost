package tables

import (
	"fmt"
	"strings"
	"time"

	"github.com/bytedance/sonic"
	bifrost "github.com/maximhq/bifrost/core"
	"gorm.io/gorm"
)

// User group usage window identifiers.
const (
	// UserGroupWindowShort is the short rolling window (e.g. "5h") used to keep
	// per-user consumption inside a provider's short rate-limit window.
	UserGroupWindowShort = "short"
	// UserGroupWindowWeekly is the long rolling window (e.g. "1w") used to keep
	// per-user consumption inside a provider's weekly rate-limit window.
	UserGroupWindowWeekly = "weekly"
)

// TableUserGroup represents a customizable user grouping (tag) used to attach a
// tiered model-degradation policy to a set of virtual keys / users. Groups are a
// separate dimension from teams: a virtual key may belong to multiple groups.
//
// Degradation is driven by per-user token consumption measured against two
// rolling windows (a short window such as "5h" and a weekly window such as "1w").
// As consumption climbs, progressively more aggressive tiers activate and rewrite
// high-cost models to cheaper ones. When the windows reset, consumption falls and
// the active tier de-escalates automatically.
type TableUserGroup struct {
	ID          string `gorm:"primaryKey;type:varchar(255)" json:"id"`
	Name        string `gorm:"type:varchar(255);not null;uniqueIndex" json:"name"`
	Description string `gorm:"type:text" json:"description"`
	Color       string `gorm:"type:varchar(50)" json:"color"`               // UI label color
	Enabled     *bool  `gorm:"not null;default:true" json:"enabled,omitempty"` // nil = DB default (true); use EnabledValue()

	// Short rolling window (e.g. "5h") — token budget that drives tier escalation.
	ShortWindowTokenLimit    *int64  `gorm:"default:null" json:"short_window_token_limit,omitempty"`
	ShortWindowResetDuration *string `gorm:"type:varchar(50)" json:"short_window_reset_duration,omitempty"`

	// Weekly rolling window (e.g. "1w") — token budget that drives tier escalation.
	WeeklyWindowTokenLimit    *int64  `gorm:"default:null" json:"weekly_window_token_limit,omitempty"`
	WeeklyWindowResetDuration *string `gorm:"type:varchar(50)" json:"weekly_window_reset_duration,omitempty"`

	// CalendarAligned snaps window resets to clean UTC boundaries (see GetCalendarPeriodStart).
	CalendarAligned bool `gorm:"default:false" json:"calendar_aligned"`

	// Relationships
	Tiers   []TableUserGroupTier   `gorm:"foreignKey:UserGroupID;constraint:OnDelete:CASCADE" json:"tiers,omitempty"`
	Members []TableUserGroupMember `gorm:"foreignKey:UserGroupID;constraint:OnDelete:CASCADE" json:"members,omitempty"`

	// Computed (not a DB column) — populated in the query/handler layer.
	MemberCount int64 `gorm:"-" json:"member_count"`

	// Config hash is used to detect changes synced from the config.json file.
	ConfigHash string `gorm:"type:varchar(255);null" json:"config_hash"`

	CreatedAt time.Time `gorm:"index;not null" json:"created_at"`
	UpdatedAt time.Time `gorm:"index;not null" json:"updated_at"`
}

// TableName sets the table name for TableUserGroup.
func (TableUserGroup) TableName() string { return "governance_user_groups" }

// EnabledValue returns the effective Enabled bool, treating nil as true (DB default).
func (g *TableUserGroup) EnabledValue() bool {
	if g == nil {
		return false
	}
	if g.Enabled == nil {
		return true
	}
	return *g.Enabled
}

// BeforeSave validates window reset durations.
func (g *TableUserGroup) BeforeSave(tx *gorm.DB) error {
	if g.ShortWindowTokenLimit != nil {
		if g.ShortWindowResetDuration == nil {
			return fmt.Errorf("short_window_reset_duration is required when short_window_token_limit is set")
		}
		if d, err := ParseDuration(*g.ShortWindowResetDuration); err != nil {
			return fmt.Errorf("invalid short_window_reset_duration format: %s", *g.ShortWindowResetDuration)
		} else if d <= 0 {
			return fmt.Errorf("short_window_reset_duration cannot be zero or negative: %s", *g.ShortWindowResetDuration)
		}
		if *g.ShortWindowTokenLimit <= 0 {
			return fmt.Errorf("short_window_token_limit cannot be zero or negative: %d", *g.ShortWindowTokenLimit)
		}
	}
	if g.WeeklyWindowTokenLimit != nil {
		if g.WeeklyWindowResetDuration == nil {
			return fmt.Errorf("weekly_window_reset_duration is required when weekly_window_token_limit is set")
		}
		if d, err := ParseDuration(*g.WeeklyWindowResetDuration); err != nil {
			return fmt.Errorf("invalid weekly_window_reset_duration format: %s", *g.WeeklyWindowResetDuration)
		} else if d <= 0 {
			return fmt.Errorf("weekly_window_reset_duration cannot be zero or negative: %s", *g.WeeklyWindowResetDuration)
		}
		if *g.WeeklyWindowTokenLimit <= 0 {
			return fmt.Errorf("weekly_window_token_limit cannot be zero or negative: %d", *g.WeeklyWindowTokenLimit)
		}
	}
	return nil
}

// TableUserGroupTier represents one degradation tier within a user group. Tiers are
// ordered; the active tier is the highest-ordered tier whose ThresholdPct is met by
// the user's current window usage percentage.
type TableUserGroupTier struct {
	ID          string `gorm:"primaryKey;type:varchar(255)" json:"id"`
	UserGroupID string `gorm:"type:varchar(255);not null;index" json:"user_group_id"`

	// TierOrder is the tier rank within the group (1 = first/least aggressive). Avoids
	// the reserved word "order" as a column name.
	TierOrder int `gorm:"type:int;not null;default:0;index" json:"order"`

	// ThresholdPct is the window usage percentage (0-100) at which this tier activates.
	ThresholdPct float64 `gorm:"not null;default:0" json:"threshold_pct"`

	// IsTerminal marks the most aggressive tier; terminal tiers may attach Fallbacks
	// for cross-model substitution when the high-cost model has no direct mapping.
	IsTerminal bool `gorm:"not null;default:false" json:"is_terminal"`

	Fallbacks       *string  `gorm:"type:text" json:"-"`           // JSON array of "provider/model"
	ParsedFallbacks []string `gorm:"-" json:"fallbacks,omitempty"` // Parsed fallbacks

	Mappings []TableUserGroupTierMapping `gorm:"foreignKey:TierID;constraint:OnDelete:CASCADE" json:"mappings,omitempty"`

	CreatedAt time.Time `gorm:"index;not null" json:"created_at"`
	UpdatedAt time.Time `gorm:"index;not null" json:"updated_at"`
}

// TableName sets the table name for TableUserGroupTier.
func (TableUserGroupTier) TableName() string { return "governance_user_group_tiers" }

// BeforeSave serializes JSON fields.
func (t *TableUserGroupTier) BeforeSave(tx *gorm.DB) error {
	if len(t.ParsedFallbacks) > 0 {
		data, err := sonic.Marshal(t.ParsedFallbacks)
		if err != nil {
			return err
		}
		t.Fallbacks = bifrost.Ptr(string(data))
	} else {
		t.Fallbacks = nil
	}
	return nil
}

// AfterFind deserializes JSON fields.
func (t *TableUserGroupTier) AfterFind(tx *gorm.DB) error {
	if t.Fallbacks != nil && strings.TrimSpace(*t.Fallbacks) != "" {
		if err := sonic.Unmarshal([]byte(*t.Fallbacks), &t.ParsedFallbacks); err != nil {
			return err
		}
	}
	return nil
}

// TableUserGroupTierMapping represents a single "source model -> downgraded model"
// substitution within a tier. A SourceModel of "*" matches any model. SourceProvider
// (when set) further narrows the match to a specific provider. SourceKeyID (when set)
// further narrows the match to a specific provider API key pinned on the request.
type TableUserGroupTierMapping struct {
	ID     string `gorm:"primaryKey;type:varchar(255)" json:"id"`
	TierID string `gorm:"type:varchar(255);not null;index" json:"tier_id"`

	SourceProvider *string `gorm:"type:varchar(255)" json:"source_provider,omitempty"` // nil = any provider
	SourceKeyID    *string `gorm:"type:varchar(255)" json:"source_key_id,omitempty"`   // nil = any key
	SourceModel    string  `gorm:"type:varchar(255);not null" json:"source_model"`     // "*" = any model

	TargetProvider *string `gorm:"type:varchar(255)" json:"target_provider,omitempty"` // nil = keep incoming provider
	TargetKeyID    *string `gorm:"type:varchar(255)" json:"target_key_id,omitempty"`   // nil = keep incoming key selection
	TargetModel    string  `gorm:"type:varchar(255);not null" json:"target_model"`
}

// TableName sets the table name for TableUserGroupTierMapping.
func (TableUserGroupTierMapping) TableName() string { return "governance_user_group_tier_mappings" }

// TableUserGroupMember associates a virtual key with a user group (many-to-many).
type TableUserGroupMember struct {
	UserGroupID  string `gorm:"primaryKey;type:varchar(255)" json:"user_group_id"`
	VirtualKeyID string `gorm:"primaryKey;type:varchar(255);index" json:"virtual_key_id"`

	CreatedAt time.Time `gorm:"not null" json:"created_at"`
}

// TableName sets the table name for TableUserGroupMember.
func (TableUserGroupMember) TableName() string { return "governance_user_group_members" }

// TableUserGroupUsage holds a per-user, per-window token counter for a user group.
// Identity is the resolved caller identity (user ID when present, otherwise the
// virtual key ID). The (Identity, UserGroupID, Window) triple is unique.
type TableUserGroupUsage struct {
	ID          string `gorm:"primaryKey;type:varchar(255)" json:"id"`
	Identity    string `gorm:"type:varchar(255);not null;uniqueIndex:idx_user_group_usage" json:"identity"`
	UserGroupID string `gorm:"type:varchar(255);not null;uniqueIndex:idx_user_group_usage;index" json:"user_group_id"`
	Window      string `gorm:"type:varchar(20);not null;uniqueIndex:idx_user_group_usage" json:"window"`

	TokenCurrentUsage int64     `gorm:"default:0" json:"token_current_usage"`
	TokenLastReset    time.Time `gorm:"index" json:"token_last_reset"`

	UpdatedAt time.Time `gorm:"not null" json:"updated_at"`
}

// TableName sets the table name for TableUserGroupUsage.
func (TableUserGroupUsage) TableName() string { return "governance_user_group_usage" }
