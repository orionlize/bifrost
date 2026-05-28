import { useGetCurrentAoneUserQuery } from "@/lib/store/apis/aoneUsersApi";
import { useIsAuthEnabledQuery } from "@/lib/store/apis/sessionApi";
import { setAoneApiKey } from "@/lib/utils/aoneUserStorage";
import { IS_ENTERPRISE } from "@/lib/constants/config";
import { useEffect } from "react";

export function useAoneCurrentUser() {
	const { data: authStatus, isFetching: authFetching } = useIsAuthEnabledQuery();
	const enabled =
		!IS_ENTERPRISE &&
		!authFetching &&
		authStatus?.aone_oauth_enabled === true &&
		authStatus?.has_valid_token === true &&
		authStatus?.is_aone_user_session === true;

	const query = useGetCurrentAoneUserQuery(undefined, { skip: !enabled });

	useEffect(() => {
		if (query.data?.api_key) {
			setAoneApiKey(query.data.api_key);
		}
	}, [query.data?.api_key]);

	const displayName =
		query.data?.dingtalk?.profile.name || query.data?.user.display_name || query.data?.user.name || query.data?.user.email || "";

	const avatar = query.data?.dingtalk?.profile.avatar || query.data?.user.display_avatar || query.data?.user.avatar || "";

	return {
		enabled,
		...query,
		displayName,
		avatar,
	};
}