import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import GradientHeader from "@/components/ui/gradientHeader";
import { useT } from "@/lib/i18n";
import { BookOpen, Code, ExternalLink, FileText, GitBranch, Play, Shield, Users, Zap } from "lucide-react";

const SECTION_ITEM_KEYS = ["item0", "item1", "item2", "item3"] as const;

const DOC_SECTION_META = [
	{ key: "quickStart", icon: Play, url: "https://github.com/maximhq/bifrost/tree/main/docs/quickstart" },
	{ key: "architecture", icon: GitBranch, url: "https://github.com/maximhq/bifrost/tree/main/docs/architecture" },
	{ key: "usageGuides", icon: BookOpen, url: "https://github.com/maximhq/bifrost/tree/main/docs/usage" },
	{ key: "contributing", icon: Users, url: "https://github.com/maximhq/bifrost/tree/main/docs/contributing" },
	{
		key: "integrationExamples",
		icon: Code,
		url: "https://github.com/maximhq/bifrost/tree/main/docs/usage/http-transport/integrations",
	},
	{ key: "benchmarks", icon: Zap, url: "https://github.com/maximhq/bifrost/blob/main/docs/benchmarks.md" },
] as const;

const FEATURED_META = [
	{
		key: "mcp",
		href: "https://github.com/maximhq/bifrost/blob/main/docs/mcp.md",
		icon: FileText,
		borderColor: "border-primary/20",
		backgroundColor: "bg-primary/5",
		iconColor: "text-primary",
	},
	{
		key: "governance",
		href: "https://github.com/maximhq/bifrost/blob/main/docs/governance.md",
		icon: Shield,
		borderColor: "border-green-200 dark:border-green-800",
		backgroundColor: "bg-green-50 dark:bg-green-950/20",
		iconColor: "text-green-600",
	},
] as const;

export default function DocsPage() {
	const t = useT();

	return (
		<div className="dark:bg-card bg-white">
			<div className="mx-auto max-w-7xl">
				<div className="space-y-8">
					<div className="space-y-4 text-center">
						<div className="bg-primary/10 text-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm">
							<BookOpen className="h-4 w-4" />
							<span className="font-semibold">{t("docs.badge")}</span>
						</div>
						<GradientHeader title={t("docs.title")} />
						<p className="text-muted-foreground mx-auto max-w-2xl text-lg">{t("docs.subtitle")}</p>
						<div className="flex justify-center gap-4">
							<Button asChild>
								<a
									href="https://github.com/maximhq/bifrost/tree/main/docs"
									target="_blank"
									rel="noopener noreferrer"
									data-testid="docs-view-full-documentation-link"
								>
									<ExternalLink className="mr-2 h-4 w-4" />
									{t("docs.viewFullDocs")}
								</a>
							</Button>
							<Button variant="outline" asChild>
								<a
									href="https://github.com/maximhq/bifrost/tree/main/docs/quickstart"
									target="_blank"
									rel="noopener noreferrer"
									data-testid="docs-quick-start-guide-link"
								>
									<Play className="mr-2 h-4 w-4" />
									{t("docs.quickStartGuide")}
								</a>
							</Button>
						</div>
					</div>

					<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
						{DOC_SECTION_META.map((section) => {
							const Icon = section.icon;
							const base = `docs.sections.${section.key}` as const;
							const badge = t(`${base}.badge`);
							return (
								<Card key={section.key} className="group transition-all duration-200 hover:shadow-lg">
									<CardHeader>
										<div className="flex items-center justify-between">
											<div className="bg-primary/10 group-hover:bg-primary/20 mb-4 flex h-12 w-12 items-center justify-center rounded-lg transition-colors">
												<Icon className="text-primary h-6 w-6" />
											</div>
											{badge !== `${base}.badge` && (
												<Badge variant="secondary" className="text-xs">
													{badge}
												</Badge>
											)}
										</div>
										<CardTitle className="text-xl">{t(`${base}.title`)}</CardTitle>
										<CardDescription className="leading-relaxed">{t(`${base}.description`)}</CardDescription>
									</CardHeader>
									<CardContent className="flex h-full flex-col justify-between gap-8">
										<ul className="space-y-2">
											{SECTION_ITEM_KEYS.map((itemKey) => {
												const item = t(`${base}.${itemKey}`);
												if (item === `${base}.${itemKey}`) return null;
												return (
													<li key={itemKey} className="text-muted-foreground flex items-center gap-2 text-sm">
														<div className="bg-primary h-1.5 w-1.5 rounded-full" />
														{item}
													</li>
												);
											})}
										</ul>
										<Button asChild variant="outline" className="w-full">
											<a
												href={section.url}
												target="_blank"
												rel="noopener noreferrer"
												className="flex items-center justify-center gap-2"
												data-testid={`docs-read-more-${section.key}`}
											>
												{t("docs.readMore")}
												<ExternalLink className="h-4 w-4" />
											</a>
										</Button>
									</CardContent>
								</Card>
							);
						})}
					</div>

					<div className="grid gap-6 pt-8 md:grid-cols-2">
						{FEATURED_META.map((doc) => {
							const base = `docs.featured.${doc.key}` as const;
							return (
								<Card className={`${doc.borderColor} ${doc.backgroundColor}`} key={doc.key}>
									<CardHeader>
										<CardTitle className="flex items-center gap-2">
											<doc.icon className={`h-5 w-5 ${doc.iconColor}`} />
											{t(`${base}.title`)}
										</CardTitle>
										<CardDescription>{t(`${base}.description`)}</CardDescription>
									</CardHeader>
									<CardContent>
										<p className="text-muted-foreground mb-4 text-sm">{t(`${base}.content`)}</p>
										<Button asChild className="w-full">
											<a href={doc.href} target="_blank" rel="noopener noreferrer" data-testid={`docs-featured-${doc.key}`}>
												<doc.icon className="mr-2 h-4 w-4" />
												{t(`${base}.button`)}
											</a>
										</Button>
									</CardContent>
								</Card>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}
