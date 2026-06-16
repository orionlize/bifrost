import {
	AONE_USER_DEFAULT_WORKSPACE_PATH,
	AONE_USER_QUICK_START_WORKSPACE_PATH,
	isWorkspacePathAllowedForAoneUser,
} from "@/lib/constants/aoneUserSession";
import { useIsAoneUserOnlySession } from "@/hooks/useIsAoneUserOnlySession";
import { useGetGlobalApiKeyAccessQuery } from "@/lib/store/apis/globalApiKeysApi";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export function AoneUserWorkspaceGuard({ children }: { children: React.ReactNode }) {
	const isAoneUserSession = useIsAoneUserOnlySession();
	const { data: accessData } = useGetGlobalApiKeyAccessQuery(undefined, { skip: !isAoneUserSession });
	const hasGlobalApiKeyAccess = accessData?.has_access === true;
	const { pathname } = useLocation();
	const navigate = useNavigate();

	useEffect(() => {
		if (!isAoneUserSession) {
			return;
		}
		if (!isWorkspacePathAllowedForAoneUser(pathname, hasGlobalApiKeyAccess)) {
			navigate({ to: hasGlobalApiKeyAccess ? AONE_USER_QUICK_START_WORKSPACE_PATH : AONE_USER_DEFAULT_WORKSPACE_PATH, replace: true });
		}
	}, [hasGlobalApiKeyAccess, isAoneUserSession, navigate, pathname]);

	return children;
}