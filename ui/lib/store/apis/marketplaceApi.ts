import {
	CreateMarketplaceItemRequest,
	MarketplaceConfig,
	MarketplaceItem,
	MarketplaceItemsListResponse,
	MarketplaceItemsQueryParams,
	MarketplaceUserAssignmentsResponse,
	ReplaceMarketplaceAssignmentsRequest,
	UpdateMarketplaceItemRequest,
} from "@/lib/types/marketplace";
import { baseApi } from "./baseApi";

export const marketplaceApi = baseApi.injectEndpoints({
	endpoints: (builder) => ({
		listMarketplaceItems: builder.query<MarketplaceItemsListResponse, MarketplaceItemsQueryParams | void>({
			query: (params) => {
				const searchParams = new URLSearchParams();
				if (params?.limit) searchParams.set("limit", String(params.limit));
				if (params?.offset) searchParams.set("offset", String(params.offset));
				if (params?.search) searchParams.set("search", params.search);
				if (params?.item_type) searchParams.set("item_type", params.item_type);
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
		createMarketplaceItem: builder.mutation<{ item: MarketplaceItem }, CreateMarketplaceItemRequest>({
			query: (body) => ({ url: "/marketplace/items", method: "POST", body }),
			invalidatesTags: ["MarketplaceItems"],
		}),
		updateMarketplaceItem: builder.mutation<{ item: MarketplaceItem }, { id: number; body: UpdateMarketplaceItemRequest }>({
			query: ({ id, body }) => ({ url: `/marketplace/items/${id}`, method: "PUT", body }),
			invalidatesTags: (_result, _error, { id }) => [{ type: "MarketplaceItems", id }, "MarketplaceItems"],
		}),
		deleteMarketplaceItem: builder.mutation<{ success: boolean }, number>({
			query: (id) => ({ url: `/marketplace/items/${id}`, method: "DELETE" }),
			invalidatesTags: ["MarketplaceItems"],
		}),
		getMarketplaceConfig: builder.query<{ marketplace: MarketplaceConfig }, void>({
			query: () => ({ url: "/marketplace/config" }),
			providesTags: ["MarketplaceConfig"],
		}),
		updateMarketplaceConfig: builder.mutation<{ marketplace: MarketplaceConfig }, MarketplaceConfig>({
			query: (body) => ({ url: "/marketplace/config", method: "PUT", body }),
			invalidatesTags: ["MarketplaceConfig"],
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
	useCreateMarketplaceItemMutation,
	useUpdateMarketplaceItemMutation,
	useDeleteMarketplaceItemMutation,
	useGetMarketplaceConfigQuery,
	useUpdateMarketplaceConfigMutation,
	useGetMarketplaceUserAssignmentsQuery,
	useReplaceMarketplaceUserAssignmentsMutation,
} = marketplaceApi;
