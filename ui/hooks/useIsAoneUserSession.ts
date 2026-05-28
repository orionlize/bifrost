import { IS_ENTERPRISE } from "@/lib/constants/config";
import { useIsAuthEnabledQuery } from "@/lib/store/apis/sessionApi";

export function useIsAoneUserSession(): boolean {
	const { data: authStatus, isFetching, isLoading } = useIsAuthEnabledQuery();
	if (IS_ENTERPRISE || isLoading || isFetching) {
		return false;
	}
	return authStatus?.has_valid_token === true && authStatus?.is_aone_user_session === true;
}
