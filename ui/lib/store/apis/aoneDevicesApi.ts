import { AoneDeviceListItem, AoneDevicesListResponse, AoneDevicesQueryParams, UpdateAoneDeviceRequest } from "@/lib/types/aoneDevice";
import { baseApi } from "./baseApi";

export const aoneDevicesApi = baseApi.injectEndpoints({
	endpoints: (builder) => ({
		listAoneDevices: builder.query<AoneDevicesListResponse, AoneDevicesQueryParams | void>({
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
				if (params?.status) {
					searchParams.set("status", params.status);
				}
				const query = searchParams.toString();
				return {
					url: `/aone/devices${query ? `?${query}` : ""}`,
				};
			},
			providesTags: ["AoneDevices"],
		}),
		updateAoneDevice: builder.mutation<AoneDeviceListItem, { id: number; body: UpdateAoneDeviceRequest }>({
			query: ({ id, body }) => ({
				url: `/aone/devices/${id}`,
				method: "PUT",
				body,
			}),
			invalidatesTags: (_result, _error, { id }) => [{ type: "AoneDevices", id }, "AoneDevices"],
		}),
	}),
});

export const { useListAoneDevicesQuery, useUpdateAoneDeviceMutation } = aoneDevicesApi;