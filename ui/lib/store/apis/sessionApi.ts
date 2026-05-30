import { IS_ENTERPRISE } from "@/lib/constants/config";
import { baseApi, clearAuthStorage } from "./baseApi";
import { setLoggingOut } from "./logoutState";
import { clearAoneApiKey } from "@/lib/utils/aoneUserStorage";

export interface LoginRequest {
	username: string;
	password: string;
}

export interface LoginResponse {
	message: string;
}

export interface IsAuthEnabledResponse {
	is_auth_enabled: boolean;
	has_valid_token: boolean;
	auth_type?: "sso" | "password" | "none";
	aone_oauth_enabled?: boolean;
	is_aone_user_session?: boolean;
	is_local_admin_session?: boolean;
}

export interface LogoutResponse {
	message: string;
}

export const sessionApi = baseApi.injectEndpoints({
	overrideExisting: false,
	endpoints: (builder) => ({
		// Check if auth is enabled
		isAuthEnabled: builder.query<IsAuthEnabledResponse, void>({
			query: () => ({
				url: "/session/is-auth-enabled",
				method: "GET",
			}),
			providesTags: ["Sessions"],
		}),
		// Login endpoint
		login: builder.mutation<LoginResponse, LoginRequest>({
			query: (credentials) => ({
				url: "/session/login",
				method: "POST",
				body: credentials,
			}),
			invalidatesTags: ["Sessions", "Config"],
		}),

		// Logout endpoint
		logout: builder.mutation<LogoutResponse, void>({
			async queryFn(_arg, _api, _extraOptions, baseQuery) {
				const passwordLogout = await baseQuery({
					url: "/session/logout",
					method: "POST",
				});

				if (IS_ENTERPRISE) {
					const oauthLogout = await baseQuery({
						url: "/scim/oauth/logout",
						method: "POST",
					});
					if (passwordLogout.error && oauthLogout.error) {
						return { error: passwordLogout.error };
					}
				} else if (passwordLogout.error) {
					return { error: passwordLogout.error };
				}

				return { data: { message: "Logout successful" } };
			},
			async onQueryStarted(_arg, { queryFulfilled }) {
				setLoggingOut(true);
				clearAuthStorage();
				clearAoneApiKey();
				try {
					await queryFulfilled;
				} catch {
					// Server logout may fail; still leave the dashboard.
				} finally {
					if (typeof window !== "undefined") {
						window.location.replace("/login");
					}
				}
			},
		}),
	}),
});

export const { useIsAuthEnabledQuery, useLoginMutation, useLogoutMutation } = sessionApi;