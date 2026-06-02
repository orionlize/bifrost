import {
	getLoginRedirectUriFromSearch,
	normalizeLoginRedirectUri,
	resolveLoginRedirectUriForOAuth,
	resolveLoginRedirectUriFromUrl,
	syncLoginRedirectStashFromLocation,
} from "@/lib/utils/loginGoto";
import { getEndpointUrl } from "@/lib/utils/port";
import {
	getLoginSourceFromSearch,
	LOGIN_SOURCE_ZD_SWITCH,
	normalizeLoginSource,
	resolveLoginSourceForOAuth,
	syncLoginSourceStashFromLocation,
} from "@/lib/utils/zdSwitchLogin";
import { useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useSyncExternalStore } from "react";

function subscribeToLocationSearch(onStoreChange: () => void): () => void {
	window.addEventListener("popstate", onStoreChange);
	return () => window.removeEventListener("popstate", onStoreChange);
}

function getLocationSearchSnapshot(): string {
	return window.location.search;
}

/** Redirect target from the current URL only (never sessionStorage). */
export function useLoginRedirectUriFromUrl(): string | null {
	const search = useSearch({ strict: false }) as { redirect_uri?: string };
	const locationSearch = useSyncExternalStore(subscribeToLocationSearch, getLocationSearchSnapshot, () => "");

	const redirectUri = useMemo(() => {
		return normalizeLoginRedirectUri(search.redirect_uri) ?? getLoginRedirectUriFromSearch(locationSearch);
	}, [locationSearch, search.redirect_uri]);

	useEffect(() => {
		syncLoginRedirectStashFromLocation();
		syncLoginSourceStashFromLocation();
	}, [locationSearch, search.redirect_uri]);

	return redirectUri;
}

/** Login source from the current URL only (never sessionStorage). */
export function useLoginSourceFromUrl(): string | null {
	const search = useSearch({ strict: false }) as { source?: string };
	const locationSearch = useSyncExternalStore(subscribeToLocationSearch, getLocationSearchSnapshot, () => "");

	return useMemo(() => {
		return normalizeLoginSource(search.source) ?? getLoginSourceFromSearch(locationSearch);
	}, [locationSearch, search.source]);
}

export function useIsZdSwitchLoginSource(): boolean {
	return useLoginSourceFromUrl() === LOGIN_SOURCE_ZD_SWITCH;
}

/** Same as URL-only — complete handoff always carries redirect_uri in query string. */
export function useLoginRedirectUri(): string | null {
	return useLoginRedirectUriFromUrl();
}

export function buildAoneOAuthAuthorizeUrl(options?: { redirectUri?: string | null; source?: string | null }): string {
	const params = new URLSearchParams();
	const redirectUri = options?.redirectUri ?? resolveLoginRedirectUriForOAuth();
	const source = options?.source ?? resolveLoginSourceForOAuth();
	if (source === LOGIN_SOURCE_ZD_SWITCH) {
		params.set("source", LOGIN_SOURCE_ZD_SWITCH);
	} else if (redirectUri) {
		params.set("redirect_uri", redirectUri);
	}
	return getEndpointUrl(`/api/aone/oauth/authorize?${params.toString()}`);
}

export function navigateToAoneOAuthAuthorize(): void {
	window.location.href = buildAoneOAuthAuthorizeUrl();
}

export function navigateToZdSwitchHandoff(): void {
	window.location.replace(getEndpointUrl("/api/aone/oauth/zd-switch/handoff"));
}