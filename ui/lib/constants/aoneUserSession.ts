import { SHOW_PROMPT_REPOSITORY } from "@/lib/constants/config";

export const AONE_USER_DEFAULT_WORKSPACE_PATH = SHOW_PROMPT_REPOSITORY
	? "/workspace/prompt-repo"
	: "/workspace/marketplace/plugins";

export const AONE_USER_WORKSPACE_PATHS = SHOW_PROMPT_REPOSITORY
	? (["/workspace/prompt-repo"] as const)
	: (["/workspace/marketplace"] as const);

export function isWorkspacePathAllowedForAoneUser(pathname: string): boolean {
	return AONE_USER_WORKSPACE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
