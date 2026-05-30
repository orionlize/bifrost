import { createFileRoute } from "@tanstack/react-router";
import LoginCompletePage from "./page";

type LoginCompleteSearch = {
	redirect_uri?: string;
};

export const Route = createFileRoute("/login/complete")({
	validateSearch: (search: Record<string, unknown>): LoginCompleteSearch => ({
		redirect_uri: typeof search.redirect_uri === "string" ? search.redirect_uri : undefined,
	}),
	component: LoginCompletePage,
});