import { createFileRoute } from "@tanstack/react-router";
import ZwitchSuccessPage from "./page";

type ZwitchSuccessSearch = {
	access_token?: string;
	base_url?: string;
};

export const Route = createFileRoute("/login/zwitch/success")({
	validateSearch: (search: Record<string, unknown>): ZwitchSuccessSearch => ({
		access_token: typeof search.access_token === "string" ? search.access_token : undefined,
		base_url: typeof search.base_url === "string" ? search.base_url : undefined,
	}),
	component: ZwitchSuccessPage,
});
