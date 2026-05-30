export interface AoneDeviceListItem {
	id: number;
	device_fingerprint: string;
	device_name: string;
	aone_user_id: string;
	user_display_name?: string;
	user_email?: string;
	status: "active" | "revoked" | string;
	is_active: boolean;
	last_api_access_at?: string;
	created_at: string;
	updated_at: string;
	revoked_at?: string;
}

export interface AoneDevicesListResponse {
	devices: AoneDeviceListItem[];
	total_count: number;
	limit: number;
	offset: number;
}

export interface AoneDevicesQueryParams {
	limit?: number;
	offset?: number;
	search?: string;
	status?: string;
}

export interface UpdateAoneDeviceRequest {
	is_active: boolean;
}