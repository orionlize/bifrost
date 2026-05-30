import { createFileRoute } from "@tanstack/react-router";
import GovernanceAoneDevicesPage from "./page";

export const Route = createFileRoute("/workspace/governance/aone-devices")({
	component: GovernanceAoneDevicesPage,
});