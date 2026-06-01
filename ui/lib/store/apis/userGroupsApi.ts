import { baseApi } from "@/lib/store/apis/baseApi";
import {
	CreateUserGroupRequest,
	GetUserGroupsResponse,
	GetUserGroupUsageResponse,
	ResetUserGroupMemberUsageRequest,
	UpdateUserGroupRequest,
	UserGroup,
} from "@/lib/types/userGroups";

export const userGroupsApi = baseApi.injectEndpoints({
	endpoints: (builder) => ({
		getUserGroups: builder.query<GetUserGroupsResponse, void>({
			query: () => ({ url: "/governance/user-groups", method: "GET" }),
			providesTags: ["UserGroups"],
		}),

		getUserGroup: builder.query<UserGroup, string>({
			query: (id) => ({ url: `/governance/user-groups/${id}`, method: "GET" }),
			transformResponse: (response: { user_group: UserGroup }) => response.user_group,
			providesTags: (result, error, arg) => [{ type: "UserGroups", id: arg }],
		}),

		createUserGroup: builder.mutation<UserGroup, CreateUserGroupRequest>({
			query: (body) => ({ url: "/governance/user-groups", method: "POST", body }),
			transformResponse: (response: { user_group: UserGroup }) => response.user_group,
			invalidatesTags: ["UserGroups"],
		}),

		updateUserGroup: builder.mutation<UserGroup, { id: string; data: UpdateUserGroupRequest }>({
			query: ({ id, data }) => ({ url: `/governance/user-groups/${id}`, method: "PUT", body: data }),
			transformResponse: (response: { user_group: UserGroup }) => response.user_group,
			invalidatesTags: (result, error, arg) => ["UserGroups", { type: "UserGroups", id: arg.id }],
		}),

		setUserGroupMembers: builder.mutation<UserGroup, { id: string; virtual_key_ids: string[] }>({
			query: ({ id, virtual_key_ids }) => ({
				url: `/governance/user-groups/${id}/members`,
				method: "PUT",
				body: { virtual_key_ids },
			}),
			transformResponse: (response: { user_group: UserGroup }) => response.user_group,
			invalidatesTags: (result, error, arg) => ["UserGroups", { type: "UserGroups", id: arg.id }],
		}),

		deleteUserGroup: builder.mutation<void, string>({
			query: (id) => ({ url: `/governance/user-groups/${id}`, method: "DELETE" }),
			invalidatesTags: ["UserGroups"],
		}),

		getUserGroupUsage: builder.query<GetUserGroupUsageResponse, string>({
			query: (id) => ({ url: `/governance/user-groups/${id}/usage`, method: "GET" }),
			providesTags: (result, error, arg) => [{ type: "UserGroups", id: `usage-${arg}` }],
		}),

		resetUserGroupMemberUsage: builder.mutation<{ message: string }, { groupId: string; data: ResetUserGroupMemberUsageRequest }>({
			query: ({ groupId, data }) => ({
				url: `/governance/user-groups/${groupId}/usage/reset`,
				method: "POST",
				body: data,
			}),
			invalidatesTags: (result, error, arg) => [{ type: "UserGroups", id: `usage-${arg.groupId}` }],
		}),
	}),
});

export const {
	useGetUserGroupsQuery,
	useGetUserGroupQuery,
	useCreateUserGroupMutation,
	useUpdateUserGroupMutation,
	useSetUserGroupMembersMutation,
	useDeleteUserGroupMutation,
	useGetUserGroupUsageQuery,
	useResetUserGroupMemberUsageMutation,
} = userGroupsApi;
