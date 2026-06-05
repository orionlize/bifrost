import { auth } from "./auth";
import { apiKeys } from "./apiKeys";
import { common } from "./common";
import { configCommon } from "./configCommon";
import { configPages } from "./configPages";
import { configViews } from "./configViews";
import { dashboard } from "./dashboard";
import { dashboardCharts } from "./dashboardCharts";
import { docs } from "./docs";
import { aone } from "./aone";
import { customers } from "./customers";
import { enterprise } from "./enterprise";
import { governance } from "./governance";
import { governancePages } from "./governancePages";
import { governanceShared } from "./governanceShared";
import { onboarding } from "./onboarding";
import { pricing } from "./pricing";
import { prompts } from "./prompts";
import { quickStart } from "./quickStart";
import { teams } from "./teams";
import { virtualKeys } from "./virtualKeys";
import { logDetail, logsMedia, logsSession } from "./logDetail";
import { logs } from "./logs";
import { logsColumns } from "./logsColumns";
import { logsEmptyState } from "./logsEmptyState";
import { logsFilters } from "./logsFilters";
import { mcp } from "./mcp";
import { mcpFilters } from "./mcpFilters";
import { observabilityConnectors } from "./observabilityConnectors";
import { modelCatalog } from "./modelCatalog";
import { modelLimits } from "./modelLimits";
import { providers } from "./providers";
import { providersKeyForm } from "./providersKeyForm";
import { features } from "./features";
import { plugins } from "./plugins";
import { routing } from "./routing";
import { shared } from "./shared";
import { sidebar } from "./sidebar";
import { system } from "./system";
import { tables } from "./tables";
import { theme } from "./theme";
import { marketplace } from "./marketplace";
import { pprof } from "./pprof";

export const en = {
	common,
	shared,
	auth,
	sidebar,
	system,
	theme,
	governance,
	governancePages,
	governanceShared,
	customers,
	teams,
	virtualKeys,
	aone,
	enterprise,
	dashboard,
	dashboardCharts,
	tables,
	configCommon,
	configPages,
	configViews,
	modelCatalog,
	modelLimits,
	plugins,
	mcp,
	mcpFilters,
	routing,
	logs,
	logsColumns,
	logsEmptyState,
	logsFilters,
	logDetail,
	logsSession,
	logsMedia,
	observabilityConnectors,
	providers,
	providersKeyForm,
	features,
	docs,
	quickStart,
	onboarding,
	pricing,
	prompts,
	apiKeys,
	pprof,
	marketplace,
} as const;
