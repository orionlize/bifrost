import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdownMenu";
import { buildCSV, downloadCSV } from "@/lib/utils/csv";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useT } from "@/lib/i18n";
import { type DashboardData, getCSVSections } from "../utils/exportUtils";

interface ExportPopoverProps {
	getData: () => DashboardData;
	onPreloadData: () => Promise<void>;
	onPdfExport: () => Promise<HTMLElement[]>;
	onPdfExportDone: () => void;
}

export function ExportPopover({ getData, onPreloadData, onPdfExport, onPdfExportDone }: ExportPopoverProps) {
	const t = useT();
	const [exporting, setExporting] = useState(false);

	const handleCsvExport = useCallback(async () => {
		setExporting(true);
		try {
			await onPreloadData();
			const sections = getCSVSections(getData(), "all");
			const parts: string[] = [];
			for (const section of sections) {
				if (section.csv.rows.length === 0) continue;
				parts.push(`# ${section.name}`);
				parts.push(buildCSV(section.csv.headers, section.csv.rows));
				parts.push("");
			}
			if (parts.length > 0) {
				downloadCSV(parts.join("\n"), "dashboard-export");
			}
		} finally {
			setExporting(false);
		}
	}, [getData, onPreloadData, t]);

	const handlePdfExport = useCallback(async () => {
		setExporting(true);

		// Yield a frame so the spinner renders before heavy work starts
		await new Promise((r) => requestAnimationFrame(r));

		try {
			const { generatePdf } = await import("@/lib/utils/pdf");

			const elements = await onPdfExport();

			const sections = elements.map((element, i) => ({
				element,
				label: [
					t("dashboardCharts.export.tabs.overview"),
					t("dashboardCharts.export.tabs.providerUsage"),
					t("dashboardCharts.export.tabs.modelRankings"),
					t("dashboardCharts.export.tabs.mcpUsage"),
				][i],
			}));

			await generatePdf(sections, "dashboard-export", {
				branding: {
					logoSrc: "/bifrost-logo.webp",
					text: t("dashboardCharts.export.poweredBy"),
				},
			});
		} finally {
			onPdfExportDone();
			setExporting(false);
		}
	}, [onPdfExport, onPdfExportDone, t]);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="default" disabled={exporting} data-testid="dashboard-export-trigger">
					{exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
					{exporting ? t("dashboardCharts.export.exporting") : t("dashboardCharts.export.export")}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={handleCsvExport} data-testid="export-csv-item">
					<FileSpreadsheet className="h-4 w-4" />
					{t("dashboardCharts.export.csv")}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={handlePdfExport} data-testid="export-pdf-item">
					<FileText className="h-4 w-4" />
					{t("dashboardCharts.export.pdf")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}