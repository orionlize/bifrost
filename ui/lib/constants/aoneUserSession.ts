/** Aone OAuth end-user sessions are scoped to the marketplace only. */
export const AONE_USER_DEFAULT_WORKSPACE_PATH = "/workspace/marketplace/plugins";

export const AONE_USER_WORKSPACE_PATHS = ["/workspace/marketplace"] as const;

export function isWorkspacePathAllowedForAoneUser(pathname: string): boolean {
	return AONE_USER_WORKSPACE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
