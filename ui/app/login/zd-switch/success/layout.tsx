import { createFileRoute } from "@tanstack/react-router";
import ZdSwitchSuccessPage from "./page";

type ZdSwitchSuccessSearch = {
	access_token?: string;
	base_url?: string;
};

export const Route = createFileRoute("/login/zd-switch/success")({
	validateSearch: (search: Record<string, unknown>): ZdSwitchSuccessSearch => ({
		access_token: typeof search.access_token === "string" ? search.access_token : undefined,
		base_url: typeof search.base_url === "string" ? search.base_url : undefined,
	}),
	component: ZdSwitchSuccessPage,
});