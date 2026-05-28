import { createFileRoute } from "@tanstack/react-router";
import QuickStartView from "./page";

export const Route = createFileRoute("/workspace/quick-start")({
	component: QuickStartView,
});