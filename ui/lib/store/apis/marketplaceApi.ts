import {
	CatalogPreset,
	ImportMarketplaceItemRequest,
	MarketplaceConfig,
	MarketplaceItem,
	MarketplaceItemsListResponse,
	MarketplaceItemsQueryParams,
	MarketplaceItemAssignmentsResponse,
	MarketplaceItemAssignmentsUpdate,
	MarketplaceUserAssignmentsResponse,
	MarketplaceUserGitCredentialsStatus,
	RemoteCatalogPreview,
	ReplaceMarketplaceAssignmentsRequest,
	UpdateMarketplaceItemRequest,
	UpdateMarketplaceUserGitCredentialsRequest,
} from "@/lib/types/marketplace";
import { getApiBaseUrl } from "@/lib/utils/port";
import { baseApi } from "./baseApi";

function buildImportFormData(payload: ImportMarketplaceItemRequest): FormData {
	const formData = new FormData();
	formData.set("source_type", payload.source_type);
	if (payload.file) formData.set("file", payload.file);
	if (payload.icon) formData.set("icon", payload.icon);
	if (payload.icon_url) formData.set("icon_url", payload.icon_url);
	if (payload.remote_url) formData.set("remote_url", payload.remote_url);
	if (payload.remote_ref) formData.set("remote_ref", payload.remote_ref);
	if (payload.catalog_url) formData.set("catalog_url", payload.catalog_url);
	if (payload.catalog_plugin) formData.set("catalog_plugin", payload.catalog_plugin);
	if (payload.git_token) formData.set("git_token", payload.git_token);
	if (payload.name) formData.set("name", payload.name);
	if (payload.item_type) formData.set("item_type", payload.item_type);
	if (payload.platform) formData.set("platform", payload.platform);
	if (payload.description) formData.set("description", payload.description);
	if (payload.version) formData.set("version", payload.version);
	if (payload.enabled !== undefined) formData.set("enabled", String(payload.enabled));
	if (payload.category) formData.set("category", payload.category);
	if (payload.tags) formData.set("tags", payload.tags);
	if (payload.assignments) {
		formData.set("assignments", JSON.stringify(payload.assignments));
	}
	return formData;
}

export const marketplaceApi = baseApi.injectEndpoints({
	endpoints: (builder) => ({
		listMarketplaceItems: builder.query<MarketplaceItemsListResponse, MarketplaceItemsQueryParams | void>({
			query: (params) => {
				const searchParams = new URLSearchParams();
				if (params?.limit) searchParams.set("limit", String(params.limit));
				if (params?.offset) searchParams.set("offset", String(params.offset));
				if (params?.search) searchParams.set("search", params.search);
				if (params?.item_type) searchParams.set("item_type", params.item_type);
				if (params?.platform) searchParams.set("platform", params.platform);
				if (params?.enabled !== undefined) searchParams.set("enabled", String(params.enabled));
				const query = searchParams.toString();
				return { url: `/marketplace/items${query ? `?${query}` : ""}` };
			},
			providesTags: ["MarketplaceItems"],
		}),
		getMarketplaceItem: builder.query<{ item: MarketplaceItem }, number>({
			query: (id) => ({ url: `/marketplace/items/${id}` }),
			providesTags: (_result, _error, id) => [{ type: "MarketplaceItems", id }],
		}),
		importMarketplaceItem: builder.mutation<{ item: MarketplaceItem }, ImportMarketplaceItemRequest>({
			queryFn: async (payload, _api, _extra, fetchWithBQ) => {
				const response = await fetch(`${getApiBaseUrl()}/marketplace/items/import`, {
					method: "POST",
					credentials: "include",
					body: buildImportFormData(payload),
				});
				const data = await response.json().catch(() => ({}));
				if (!response.ok) {
					return {
						error: {
							status: response.status,
							data,
						},
					};
				}
				return { data: data as { item: MarketplaceItem } };
			},
			invalidatesTags: ["MarketplaceItems"],
		}),
		syncMarketplaceItem: builder.mutation<{ item: MarketplaceItem }, { id: number; git_token?: string }>({
			queryFn: async ({ id, git_token }) => {
				const headers: Record<string, string> = {};
				if (git_token) {
					headers["X-Marketplace-Git-Token"] = git_token;
				}
				const response = await fetch(`${getApiBaseUrl()}/marketplace/items/${id}/sync`, {
					method: "POST",
					credentials: "include",
					headers,
				});
				const data = await response.json().catch(() => ({}));
				if (!response.ok) {
					return {
						error: {
							status: response.status,
							data,
						},
					};
				}
				return { data: data as { item: MarketplaceItem } };
			},
			invalidatesTags: (_result, _error, { id }) => [{ type: "MarketplaceItems", id }, "MarketplaceItems"],
		}),
		uploadMarketplaceItemIcon: builder.mutation<{ item: MarketplaceItem }, { id: number; icon?: File; icon_url?: string }>({
			queryFn: async ({ id, icon, icon_url }) => {
				const formData = new FormData();
				if (icon) formData.set("icon", icon);
				if (icon_url) formData.set("icon_url", icon_url);
				const response = await fetch(`${getApiBaseUrl()}/marketplace/items/${id}/icon`, {
					method: "POST",
					credentials: "include",
					body: formData,
				});
				const data = await response.json().catch(() => ({}));
				if (!response.ok) {
					return { error: { status: response.status, data } };
				}
				return { data: data as { item: MarketplaceItem } };
			},
			invalidatesTags: (_result, _error, { id }) => [{ type: "MarketplaceItems", id }, "MarketplaceItems"],
		}),
		updateMarketplaceItem: builder.mutation<{ item: MarketplaceItem }, { id: number; body: UpdateMarketplaceItemRequest }>({
			query: ({ id, body }) => ({ url: `/marketplace/items/${id}`, method: "PUT", body }),
			invalidatesTags: (_result, _error, { id }) => [
				{ type: "MarketplaceItems", id },
				{ type: "MarketplaceAssignments", id: `item-${id}` },
				"MarketplaceItems",
			],
		}),
		deleteMarketplaceItem: builder.mutation<{ success: boolean }, number>({
			query: (id) => ({ url: `/marketplace/items/${id}`, method: "DELETE" }),
			invalidatesTags: ["MarketplaceItems"],
		}),
		getMarketplaceConfig: builder.query<{ marketplace: MarketplaceConfig }, void>({
			query: () => ({ url: "/marketplace/config" }),
			providesTags: ["MarketplaceConfig"],
		}),
		listCatalogPresets: builder.query<{ presets: CatalogPreset[] }, void>({
			query: () => ({ url: "/marketplace/catalog/presets" }),
		}),
		previewCatalog: builder.query<{ catalog: RemoteCatalogPreview }, string>({
			query: (url) => ({ url: `/marketplace/catalog/preview?url=${encodeURIComponent(url)}` }),
		}),
		updateMarketplaceConfig: builder.mutation<{ marketplace: MarketplaceConfig }, MarketplaceConfig>({
			query: (body) => ({ url: "/marketplace/config", method: "PUT", body }),
			invalidatesTags: ["MarketplaceConfig"],
		}),
		getMarketplaceGitCredentials: builder.query<{ git_credentials: MarketplaceUserGitCredentialsStatus }, void>({
			query: () => ({ url: "/marketplace/my/git-credentials" }),
			providesTags: ["MarketplaceGitCredentials"],
		}),
		updateMarketplaceGitCredentials: builder.mutation<
			{ git_credentials: MarketplaceUserGitCredentialsStatus },
			UpdateMarketplaceUserGitCredentialsRequest
		>({
			query: (body) => ({ url: "/marketplace/my/git-credentials", method: "PUT", body }),
			invalidatesTags: ["MarketplaceGitCredentials"],
		}),
		getMarketplaceItemAssignments: builder.query<MarketplaceItemAssignmentsResponse, number>({
			query: (id) => ({ url: `/marketplace/items/${id}/assignments` }),
			providesTags: (_result, _error, id) => [{ type: "MarketplaceAssignments", id: `item-${id}` }],
		}),
		replaceMarketplaceItemAssignments: builder.mutation<
			MarketplaceItemAssignmentsResponse,
			{ id: number; body: MarketplaceItemAssignmentsUpdate }
		>({
			query: ({ id, body }) => ({
				url: `/marketplace/items/${id}/assignments`,
				method: "PUT",
				body,
			}),
			invalidatesTags: (_result, _error, { id }) => [{ type: "MarketplaceAssignments", id: `item-${id}` }, "MarketplaceItems"],
		}),
		getMarketplaceUserAssignments: builder.query<MarketplaceUserAssignmentsResponse, string>({
			query: (userId) => ({ url: `/marketplace/users/${encodeURIComponent(userId)}/assignments` }),
			providesTags: (_result, _error, userId) => [{ type: "MarketplaceAssignments", id: userId }],
		}),
		replaceMarketplaceUserAssignments: builder.mutation<
			{ user_id: string; item_ids: number[] },
			{ userId: string; body: ReplaceMarketplaceAssignmentsRequest }
		>({
			query: ({ userId, body }) => ({
				url: `/marketplace/users/${encodeURIComponent(userId)}/assignments`,
				method: "PUT",
				body,
			}),
			invalidatesTags: (_result, _error, { userId }) => [{ type: "MarketplaceAssignments", id: userId }],
		}),
	}),
});

export const {
	useListMarketplaceItemsQuery,
	useGetMarketplaceItemQuery,
	useImportMarketplaceItemMutation,
	useSyncMarketplaceItemMutation,
	useUploadMarketplaceItemIconMutation,
	useUpdateMarketplaceItemMutation,
	useDeleteMarketplaceItemMutation,
	useGetMarketplaceConfigQuery,
	useListCatalogPresetsQuery,
	useLazyPreviewCatalogQuery,
	useUpdateMarketplaceConfigMutation,
	useGetMarketplaceGitCredentialsQuery,
	useUpdateMarketplaceGitCredentialsMutation,
	useGetMarketplaceItemAssignmentsQuery,
	useReplaceMarketplaceItemAssignmentsMutation,
	useGetMarketplaceUserAssignmentsQuery,
	useReplaceMarketplaceUserAssignmentsMutation,
} = marketplaceApi;
