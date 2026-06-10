/** Aone OAuth end-user sessions are scoped to the marketplace only. */
export const AONE_USER_DEFAULT_WORKSPACE_PATH = "/workspace/marketplace/plugins";

export const AONE_USER_WORKSPACE_PATHS = ["/workspace/marketplace"] as const;

export const AONE_USER_QUICK_START_WORKSPACE_PATH = "/workspace/quick-start";

export function isWorkspacePathAllowedForAoneUser(pathname: string, hasGlobalApiKeyAccess = false): boolean {
	if (hasGlobalApiKeyAccess && (pathname === AONE_USER_QUICK_START_WORKSPACE_PATH || pathname.startsWith(`${AONE_USER_QUICK_START_WORKSPACE_PATH}/`))) {
		return true;
	}
	return AONE_USER_WORKSPACE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
