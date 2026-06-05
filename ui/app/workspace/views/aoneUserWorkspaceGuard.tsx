import { AONE_USER_DEFAULT_WORKSPACE_PATH, isWorkspacePathAllowedForAoneUser } from "@/lib/constants/aoneUserSession";
import { useIsAoneUserSession } from "@/hooks/useIsAoneUserSession";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export function AoneUserWorkspaceGuard({ children }: { children: React.ReactNode }) {
	const isAoneUserSession = useIsAoneUserSession();
	const { pathname } = useLocation();
	const navigate = useNavigate();

	useEffect(() => {
		if (!isAoneUserSession) {
			return;
		}
		if (!isWorkspacePathAllowedForAoneUser(pathname)) {
			navigate({ to: AONE_USER_DEFAULT_WORKSPACE_PATH, replace: true });
		}
	}, [isAoneUserSession, navigate, pathname]);

	return children;
}