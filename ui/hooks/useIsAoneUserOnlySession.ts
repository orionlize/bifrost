import { IS_ENTERPRISE } from "@/lib/constants/config";
import { useIsAuthEnabledQuery } from "@/lib/store/apis/sessionApi";

/** Aone OAuth user session without a parallel local-admin session. */
export function useIsAoneUserOnlySession(): boolean {
	const { data: authStatus, isFetching, isLoading } = useIsAuthEnabledQuery();
	if (IS_ENTERPRISE || isLoading || isFetching) {
		return false;
	}
	if (authStatus?.has_valid_token !== true || authStatus.is_aone_user_session !== true) {
		return false;
	}
	return authStatus.is_local_admin_session !== true;
}
