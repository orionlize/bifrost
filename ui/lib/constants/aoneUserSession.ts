export const AONE_USER_WORKSPACE_PATHS = ["/workspace/prompt-repo"] as const;

export function isWorkspacePathAllowedForAoneUser(pathname: string): boolean {
	return AONE_USER_WORKSPACE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}