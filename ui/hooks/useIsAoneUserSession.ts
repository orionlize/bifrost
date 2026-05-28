import { IS_ENTERPRISE } from "@/lib/constants/config";
import { useIsAuthEnabledQuery } from "@/lib/store/apis/sessionApi";

export function useIsAoneUserSession(): boolean {
	const { data: authStatus } = useIsAuthEnabledQuery();
	return !IS_ENTERPRISE && authStatus?.has_valid_token === true && authStatus?.is_aone_user_session === true;
}