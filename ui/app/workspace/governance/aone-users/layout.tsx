import { createFileRoute } from "@tanstack/react-router";
import GovernanceAoneUsersPage from "./page";

export const Route = createFileRoute("/workspace/governance/aone-users")({
	component: GovernanceAoneUsersPage,
});
