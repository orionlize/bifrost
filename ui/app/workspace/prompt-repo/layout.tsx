import { SHOW_PROMPT_REPOSITORY } from "@/lib/constants/config";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import PromptsPage from "./page";

function RouteComponent() {
	if (!SHOW_PROMPT_REPOSITORY) {
		return <Navigate to="/workspace/marketplace/plugins" replace />;
	}
	return <PromptsPage />;
}

export const Route = createFileRoute("/workspace/prompt-repo")({
	component: RouteComponent,
});
