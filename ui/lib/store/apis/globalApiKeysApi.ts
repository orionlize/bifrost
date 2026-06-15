import { baseApi } from "./baseApi";

export type GlobalApiKey = {
	id: string;
	name: string;
	token_prefix: string;
	token?: string;
	is_active: boolean;
	allowed_user_ids?: string[];
	created_at: string;
	updated_at: string;
};

export type CreateGlobalApiKeyResponse = {
	api_key: GlobalApiKey;
	token: string;
};

export type GlobalApiKeyAccessResponse = {
	has_access: boolean;
	api_keys: GlobalApiKey[];
};

export const globalApiKeysApi = baseApi.injectEndpoints({
	overrideExisting: false,
	endpoints: (builder) => ({
		listGlobalApiKeys: builder.query<{ api_keys: GlobalApiKey[] }, void>({
			query: () => ({
				url: "/settings/api-keys",
				method: "GET",
			}),
			providesTags: ["APIKeys"],
		}),
		getGlobalApiKeyAccess: builder.query<GlobalApiKeyAccessResponse, void>({
			query: () => ({
				url: "/settings/api-keys/access",
				method: "GET",
			}),
			providesTags: ["APIKeys"],
		}),
		getGlobalApiKeyToken: builder.query<{ token: string }, string>({
			query: (id) => ({
				url: `/settings/api-keys/access/${encodeURIComponent(id)}/token`,
				method: "GET",
			}),
			providesTags: (_result, _error, id) => [{ type: "APIKeys", id: `access-token-${id}` }],
		}),
		createGlobalApiKey: builder.mutation<CreateGlobalApiKeyResponse, { name: string; allowed_user_ids?: string[] }>({
			query: (body) => ({
				url: "/settings/api-keys",
				method: "POST",
				body,
			}),
			invalidatesTags: ["APIKeys"],
		}),
		updateGlobalApiKey: builder.mutation<{ api_key: GlobalApiKey }, { id: string; is_active?: boolean; allowed_user_ids?: string[] }>({
			query: ({ id, ...body }) => ({
				url: `/settings/api-keys/${id}`,
				method: "PUT",
				body,
			}),
			invalidatesTags: ["APIKeys"],
		}),
		deleteGlobalApiKey: builder.mutation<{ message: string }, string>({
			query: (id) => ({
				url: `/settings/api-keys/${id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["APIKeys"],
		}),
		rotateGlobalApiKeyToken: builder.mutation<CreateGlobalApiKeyResponse, string>({
			query: (id) => ({
				url: `/settings/api-keys/${id}/rotate-token`,
				method: "POST",
			}),
			invalidatesTags: ["APIKeys"],
		}),
	}),
});

export const {
	useListGlobalApiKeysQuery,
	useGetGlobalApiKeyAccessQuery,
	useGetGlobalApiKeyTokenQuery,
	useCreateGlobalApiKeyMutation,
	useUpdateGlobalApiKeyMutation,
	useDeleteGlobalApiKeyMutation,
	useRotateGlobalApiKeyTokenMutation,
} = globalApiKeysApi;