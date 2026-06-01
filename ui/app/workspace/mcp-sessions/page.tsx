import FullPageLoader from "@/components/fullPageLoader";
import { useT } from "@/lib/i18n";
import { getErrorMessage, useGetMCPSessionsQuery } from "@/lib/store";
import SessionsTable from "./views/sessionsTable";

export default function MCPSessionsPage() {
	const t = useT();
	const { data, isLoading, isError, error } = useGetMCPSessionsQuery();

	if (isLoading) {
		return <FullPageLoader />;
	}

	if (isError) {
		return (
			<div className="mx-auto w-full max-w-7xl">
				<div className="border-destructive bg-destructive/10 text-destructive rounded-lg border p-6 text-sm">
					{t("mcp.sessions.loadFailed")} {getErrorMessage(error)}
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-7xl">
			<SessionsTable sessions={data?.sessions ?? []} />
		</div>
	);
}