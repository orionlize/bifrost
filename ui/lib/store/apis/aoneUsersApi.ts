import {
	AoneDepartmentTreeResponse,
	AoneDepartmentsListResponse,
	AoneDepartmentsQueryParams,
	AoneUserDetailResponse,
	AoneUsersListResponse,
	AoneUsersQueryParams,
	UpdateAoneUserRequest,
} from "@/lib/types/aoneUser";
import { baseApi } from "./baseApi";

export const aoneUsersApi = baseApi.injectEndpoints({
	endpoints: (builder) => ({
		listAoneUsers: builder.query<AoneUsersListResponse, AoneUsersQueryParams | void>({
			query: (params) => {
				const searchParams = new URLSearchParams();
				if (params?.limit) {
					searchParams.set("limit", String(params.limit));
				}
				if (params?.offset) {
					searchParams.set("offset", String(params.offset));
				}
				if (params?.search) {
					searchParams.set("search", params.search);
				}
				const query = searchParams.toString();
				return {
					url: `/aone/users${query ? `?${query}` : ""}`,
				};
			},
			providesTags: ["AoneUsers"],
		}),
		listAoneDepartments: builder.query<AoneDepartmentsListResponse, AoneDepartmentsQueryParams | void>({
			query: (params) => {
				const searchParams = new URLSearchParams();
				if (params?.limit) {
					searchParams.set("limit", String(params.limit));
				}
				if (params?.offset) {
					searchParams.set("offset", String(params.offset));
				}
				if (params?.search) {
					searchParams.set("search", params.search);
				}
				const query = searchParams.toString();
				return {
					url: `/aone/departments${query ? `?${query}` : ""}`,
				};
			},
			providesTags: ["AoneDepartments"],
		}),
		getAoneDepartmentTree: builder.query<AoneDepartmentTreeResponse, void>({
			query: () => ({
				url: "/aone/departments/tree",
			}),
			providesTags: ["AoneDepartments"],
		}),
		getAoneUser: builder.query<AoneUserDetailResponse, string>({
			query: (id) => ({
				url: `/aone/users/${encodeURIComponent(id)}`,
			}),
			providesTags: (_result, _error, id) => [{ type: "AoneUsers", id }],
		}),
		getCurrentAoneUser: builder.query<AoneUserDetailResponse, void>({
			query: () => ({
				url: "/aone/users/me",
			}),
			providesTags: ["AoneUsers"],
		}),
		updateAoneUser: builder.mutation<AoneUserDetailResponse, { id: string; body: UpdateAoneUserRequest }>({
			query: ({ id, body }) => ({
				url: `/aone/users/${encodeURIComponent(id)}`,
				method: "PUT",
				body,
			}),
			invalidatesTags: (_result, _error, { id }) => [{ type: "AoneUsers", id }, "AoneUsers"],
		}),
		rotateAoneUserApiKey: builder.mutation<AoneUserDetailResponse, string>({
			query: (id) => ({
				url: `/aone/users/${encodeURIComponent(id)}/rotate-api-key`,
				method: "POST",
			}),
			invalidatesTags: (_result, _error, id) => [{ type: "AoneUsers", id }, "AoneUsers"],
		}),
	}),
});

export const {
	useListAoneUsersQuery,
	useListAoneDepartmentsQuery,
	useGetAoneDepartmentTreeQuery,
	useGetAoneUserQuery,
	useGetCurrentAoneUserQuery,
	useUpdateAoneUserMutation,
	useRotateAoneUserApiKeyMutation,
} = aoneUsersApi;
