import { IS_ENTERPRISE } from "@/lib/constants/config";
import { DEFAULT_POST_LOGIN_PATH } from "@/lib/utils/loginGoto";
import { probeAuthSession } from "@/lib/utils/authRedirect";
import { getEndpointUrl } from "@/lib/utils/port";
import { baseApi, clearAuthStorage } from "./baseApi";
import { setLoggingOut } from "./logoutState";
import { clearAoneApiKey } from "@/lib/utils/aoneUserStorage";

export interface LoginRequest {
	username: string;
	password: string;
}

export interface LoginResponse {
	message: string;
	establish_path?: string;
}

export interface IsAuthEnabledResponse {
	is_auth_enabled: boolean;
	has_valid_token: boolean;
	auth_type?: "sso" | "password" | "none";
	aone_oauth_enabled?: boolean;
	is_aone_user_session?: boolean;
	is_local_admin_session?: boolean;
}

export interface LogoutRequest {
	scope?: "admin" | "user";
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
		logout: builder.mutation<LogoutResponse, LogoutRequest | void>({
			async queryFn(arg, _api, _extraOptions, baseQuery) {
				const scope = arg && typeof arg === "object" && arg.scope ? arg.scope : "user";
				const passwordLogout = await baseQuery({
					url: "/session/logout",
					method: "POST",
					body: { scope },
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
			async onQueryStarted(arg, { queryFulfilled }) {
				setLoggingOut(true);
				clearAuthStorage();
				clearAoneApiKey();
				const scope = arg && typeof arg === "object" && arg.scope ? arg.scope : "user";
				try {
					await queryFulfilled;
					const authStatus = await probeAuthSession();
					if (typeof window === "undefined") {
						return;
					}
					if (authStatus?.has_valid_token) {
						if (scope === "user" && authStatus.is_local_admin_session) {
							window.location.replace(getEndpointUrl("/workspace/logs"));
							return;
						}
						if (scope === "admin" && authStatus.is_aone_user_session) {
							window.location.replace(getEndpointUrl(DEFAULT_POST_LOGIN_PATH));
							return;
						}
					}
					window.location.replace(getEndpointUrl("/login"));
				} catch {
					if (typeof window !== "undefined") {
						window.location.replace(getEndpointUrl("/login"));
					}
				}
			},
		}),
	}),
});

export const { useIsAuthEnabledQuery, useLoginMutation, useLogoutMutation } = sessionApi;