// User group (tag) types for tiered, group-based model degradation.
// Mirrors the Go tables in framework/configstore/tables/usergroup.go.

export interface UserGroupTierMapping {
	id?: string;
	tier_id?: string;
	source_provider?: string; // omit/empty = any provider
	source_key_id?: string; // omit/empty = any key
	source_model: string; // "*" = any model
	target_provider?: string; // omit = keep incoming provider
	target_key_id?: string; // omit = keep incoming key selection
	target_model: string;
}

export interface UserGroupTier {
	id?: string;
	user_group_id?: string;
	order: number;
	threshold_pct: number; // 0-100
	is_terminal: boolean;
	fallbacks?: string[]; // ["provider/model", ...] — terminal tiers
	mappings?: UserGroupTierMapping[];
}

export interface UserGroupMember {
	user_group_id: string;
	virtual_key_id: string;
}

export interface UserGroup {
	id: string;
	name: string;
	description?: string;
	color?: string;
	enabled?: boolean;

	short_window_token_limit?: number;
	short_window_reset_duration?: string; // e.g. "5h"

	weekly_window_token_limit?: number;
	weekly_window_reset_duration?: string; // e.g. "1w"

	calendar_aligned?: boolean;

	tiers?: UserGroupTier[];
	members?: UserGroupMember[];
	member_count?: number;

	created_at?: string;
	updated_at?: string;
}

// ---- Request / response payloads ----

export interface UserGroupTierMappingInput {
	source_provider?: string;
	source_key_id?: string;
	source_model: string;
	target_provider?: string;
	target_key_id?: string;
	target_model: string;
}

export interface UserGroupTierInput {
	order: number;
	threshold_pct: number;
	is_terminal: boolean;
	fallbacks?: string[];
	mappings?: UserGroupTierMappingInput[];
}

export interface CreateUserGroupRequest {
	name: string;
	description?: string;
	color?: string;
	enabled?: boolean;
	short_window_token_limit?: number;
	short_window_reset_duration?: string;
	weekly_window_token_limit?: number;
	weekly_window_reset_duration?: string;
	calendar_aligned?: boolean;
	tiers?: UserGroupTierInput[];
	virtual_key_ids?: string[];
}

export interface UpdateUserGroupRequest {
	name?: string;
	description?: string;
	color?: string;
	enabled?: boolean;
	short_window_token_limit?: number;
	short_window_reset_duration?: string;
	weekly_window_token_limit?: number;
	weekly_window_reset_duration?: string;
	calendar_aligned?: boolean;
	tiers?: UserGroupTierInput[];
	virtual_key_ids?: string[];
}

export interface GetUserGroupsResponse {
	user_groups: UserGroup[];
	count: number;
}

// ---- Live per-user usage / degradation status ----

export interface UserGroupWindowStatus {
	window: string; // "short" | "weekly"
	token_limit?: number;
	token_used: number;
	percent_used: number;
	reset_duration?: string;
	last_reset?: string;
}

export interface UserGroupMemberUsage {
	identity: string; // virtual key ID
	virtual_key_name?: string;
	usage_percent: number;
	windows: UserGroupWindowStatus[];
	active_tier_order?: number;
	active_tier_threshold_pct?: number;
	active_tier_is_terminal: boolean;
}

export interface GetUserGroupUsageResponse {
	usage: UserGroupMemberUsage[];
	count: number;
}

export interface ResetUserGroupMemberUsageRequest {
	identity: string;
}
