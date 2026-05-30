import { useGetCoreConfigQuery, useGetWebsiteConfigQuery } from "@/lib/store";
import { DefaultWebsiteConfig, parseWebsiteConfig, websiteConfigFromMetadata, type WebsiteConfig } from "@/lib/types/websiteConfig";
import { useMemo } from "react";

export function useWebsiteConfig(options?: { preferPublicApi?: boolean }) {
	const preferPublicApi = options?.preferPublicApi ?? false;
	const coreQuery = useGetCoreConfigQuery({}, { skip: preferPublicApi });
	const publicQuery = useGetWebsiteConfigQuery(undefined, {
		skip: !preferPublicApi && coreQuery.isSuccess,
	});

	const config = useMemo((): WebsiteConfig => {
		if (!preferPublicApi && coreQuery.data?.metadata) {
			return websiteConfigFromMetadata(coreQuery.data.metadata as Record<string, unknown>);
		}
		if (publicQuery.data?.website !== undefined) {
			return parseWebsiteConfig(publicQuery.data.website);
		}
		return { ...DefaultWebsiteConfig };
	}, [coreQuery.data?.metadata, preferPublicApi, publicQuery.data?.website]);

	const isLoaded = preferPublicApi
		? publicQuery.isSuccess || publicQuery.isError
		: coreQuery.isSuccess || coreQuery.isError || publicQuery.isSuccess || publicQuery.isError;

	return { config, isLoaded };
}