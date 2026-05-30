import { defaultAuthenticatedPath, probeAuthSession, shouldEnterDashboard } from "@/lib/utils/authRedirect";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const auth = await probeAuthSession();
		throw redirect({
			to: shouldEnterDashboard(auth) ? defaultAuthenticatedPath() : "/login",
			replace: true,
		});
	},
});