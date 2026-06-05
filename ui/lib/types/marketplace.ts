export type MarketplaceItemType = "skill" | "plugin";

export interface MarketplaceOwner {
	name: string;
	email?: string;
}

export interface MarketplaceConfig {
	name: string;
	owner: MarketplaceOwner;
	public_read?: boolean;
}

export interface MarketplaceItemBundle {
	plugin_json?: Record<string, unknown>;
	skill_md?: string;
	files?: Record<string, string>;
}

export interface MarketplaceItem {
	id: number;
	name: string;
	item_type: MarketplaceItemType;
	description?: string;
	version?: string;
	source?: string;
	enabled: boolean;
	category?: string;
	tags?: string[];
	content?: MarketplaceItemBundle;
	created_at?: string;
	updated_at?: string;
}

export interface MarketplaceItemsListResponse {
	items: MarketplaceItem[];
	total_count: number;
	limit: number;
	offset: number;
}

export interface MarketplaceItemsQueryParams {
	limit?: number;
	offset?: number;
	search?: string;
	item_type?: MarketplaceItemType;
	enabled?: boolean;
}

export interface CreateMarketplaceItemRequest {
	name: string;
	item_type: MarketplaceItemType;
	description?: string;
	version?: string;
	source?: string;
	enabled?: boolean;
	category?: string;
	tags?: string[];
	content?: MarketplaceItemBundle;
}

export interface UpdateMarketplaceItemRequest {
	name?: string;
	item_type?: MarketplaceItemType;
	description?: string;
	version?: string;
	source?: string;
	enabled?: boolean;
	category?: string;
	tags?: string[];
	content?: MarketplaceItemBundle;
}

export interface MarketplaceUserAssignmentsResponse {
	user_id: string;
	item_ids: number[];
	items: MarketplaceItem[];
}

export interface ReplaceMarketplaceAssignmentsRequest {
	item_ids: number[];
}
