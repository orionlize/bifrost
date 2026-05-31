import { baseApi } from "./baseApi";

export type GlobalApiKey = {
	id: string;
	name: string;
	token_prefix: string;
	is_active: boolean;
	created_at: string;
	updated_at: string;
};

export type CreateGlobalApiKeyResponse = {
	api_key: GlobalApiKey;
	token: string;
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
		createGlobalApiKey: builder.mutation<CreateGlobalApiKeyResponse, { name: string }>({
			query: (body) => ({
				url: "/settings/api-keys",
				method: "POST",
				body,
			}),
			invalidatesTags: ["APIKeys"],
		}),
		updateGlobalApiKey: builder.mutation<{ api_key: GlobalApiKey }, { id: string; is_active: boolean }>({
			query: ({ id, is_active }) => ({
				url: `/settings/api-keys/${id}`,
				method: "PUT",
				body: { is_active },
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
	}),
});

export const { useListGlobalApiKeysQuery, useCreateGlobalApiKeyMutation, useUpdateGlobalApiKeyMutation, useDeleteGlobalApiKeyMutation } =
	globalApiKeysApi;
