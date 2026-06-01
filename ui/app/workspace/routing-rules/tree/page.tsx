/**
 * Routing Tree Page
 * Full-canvas read-only routing rules decision tree visualizer.
 */

import { useT } from "@/lib/i18n";
import { useEffect } from "react";
import { RoutingTreeView } from "./views/routingTreeView";

export default function RoutingTreePage() {
	const t = useT();

	useEffect(() => {
		document.title = t("routing.tree.title");
	}, [t]);

	return (
		<div className="no-padding-parent no-border-parent h-[calc(100dvh_)] w-full">
			<RoutingTreeView />
		</div>
	);
}