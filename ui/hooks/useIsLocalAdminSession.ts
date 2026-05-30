import { IS_ENTERPRISE } from "@/lib/constants/config";
import { useIsAuthEnabledQuery } from "@/lib/store/apis/sessionApi";

/** Password-admin (or auth-disabled) dashboard session — not an Aone OAuth user session. */
export function useIsLocalAdminSession(): boolean {
	const { data: authStatus, isFetching, isLoading } = useIsAuthEnabledQuery();
	if (IS_ENTERPRISE || isLoading || isFetching) {
		return true;
	}
	if (!authStatus?.is_auth_enabled) {
		return true;
	}
	if (authStatus.is_local_admin_session != null) {
		return authStatus.is_local_admin_session;
	}
	return authStatus.has_valid_token === true && authStatus.is_aone_user_session !== true;
}