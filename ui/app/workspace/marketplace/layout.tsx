import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/workspace/marketplace")({
	component: () => <Outlet />,
});
