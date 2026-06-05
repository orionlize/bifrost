export type MarketplaceItemType = "skill" | "plugin";

export type MarketplacePlatform = "claude" | "codex";

export type MarketplaceImportSourceType = "zip" | "github" | "gitlab" | "catalog";

export interface MarketplaceOwner {
	name: string;
	email?: string;
}

export interface MarketplaceConfig {
	name: string;
	owner: MarketplaceOwner;
	public_read?: boolean;
	catalog_sources?: MarketplaceCatalogSource[];
}

export interface MarketplaceUserGitCredentialsStatus {
	github_token_configured: boolean;
	gitlab_token_configured: boolean;
}

export interface UpdateMarketplaceUserGitCredentialsRequest {
	github_token?: string;
	gitlab_token?: string;
}

export interface MarketplaceCatalogSource {
	id: string;
	label: string;
	url: string;
	platform?: MarketplacePlatform;
	description?: string;
	official?: boolean;
	enabled?: boolean;
}

export interface MarketplaceItemBundle {
	plugin_json?: Record<string, unknown>;
	skill_md?: string;
	files?: Record<string, string>;
}

export interface MarketplaceItem {
	id: number;
	name: string;
	platform?: MarketplacePlatform;
	item_type: MarketplaceItemType;
	description?: string;
	version?: string;
	source_type?: MarketplaceImportSourceType;
	remote_url?: string;
	remote_ref?: string;
	icon_url?: string;
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
	platform?: MarketplacePlatform;
	enabled?: boolean;
}

export interface UpdateMarketplaceItemRequest {
	name?: string;
	item_type?: MarketplaceItemType;
	description?: string;
	version?: string;
	icon_url?: string;
	clear_icon?: boolean;
	enabled?: boolean;
	category?: string;
	tags?: string[];
	users?: string[];
	departments?: string[];
}

export interface ImportMarketplaceItemRequest {
	source_type: MarketplaceImportSourceType;
	platform?: MarketplacePlatform;
	file?: File;
	icon?: File;
	icon_url?: string;
	remote_url?: string;
	remote_ref?: string;
	catalog_url?: string;
	catalog_plugin?: string;
	git_token?: string;
	name?: string;
	item_type?: MarketplaceItemType;
	description?: string;
	version?: string;
	enabled?: boolean;
	category?: string;
	tags?: string;
	assignments?: MarketplaceItemAssignmentsUpdate;
}

export interface MarketplaceItemAssignmentsResponse {
	item_id: number;
	users: string[];
	departments: string[];
}

export interface MarketplaceItemAssignmentsUpdate {
	users?: string[];
	departments?: string[];
}

export interface MarketplaceUserAssignmentsResponse {
	user_id: string;
	item_ids: number[];
	items: MarketplaceItem[];
}

export interface ReplaceMarketplaceAssignmentsRequest {
	item_ids: number[];
}

export interface CatalogPreset {
	id: string;
	label: string;
	description: string;
	url: string;
	platform?: MarketplacePlatform;
	official?: boolean;
}

export interface RemoteCatalogPlugin {
	name: string;
	description?: string;
	version?: string;
	category?: string;
}

export interface RemoteCatalogPreview {
	name: string;
	description?: string;
	manifest_url: string;
	owner_name?: string;
	plugins: RemoteCatalogPlugin[];
	plugin_count: number;
}
