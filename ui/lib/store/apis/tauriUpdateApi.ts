import { TauriUpdateConfig } from "@/lib/types/tauriUpdate";
import { baseApi } from "./baseApi";

export const tauriUpdateApi = baseApi.injectEndpoints({
	endpoints: (builder) => ({
		getTauriUpdateConfig: builder.query<{ tauri_update: TauriUpdateConfig }, void>({
			query: () => ({
				url: "/aone/zwitch/update-config",
				method: "GET",
			}),
			providesTags: ["TauriUpdateConfig"],
		}),
		updateTauriUpdateConfig: builder.mutation<{ tauri_update: TauriUpdateConfig }, TauriUpdateConfig>({
			query: (body) => ({
				url: "/aone/zwitch/update-config",
				method: "PUT",
				body,
			}),
			invalidatesTags: ["TauriUpdateConfig"],
		}),
	}),
});

export const { useGetTauriUpdateConfigQuery, useUpdateTauriUpdateConfigMutation } = tauriUpdateApi;