import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scrollArea";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useGetAoneDepartmentTreeQuery } from "@/lib/store/apis/aoneUsersApi";
import type { AoneDepartmentTreeNode } from "@/lib/types/aoneUser";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function collectDepartmentLabels(nodes: AoneDepartmentTreeNode[], map = new Map<string, string>()) {
	for (const node of nodes) {
		map.set(String(node.dept_id), node.full_path || node.name);
		if (node.children?.length) {
			collectDepartmentLabels(node.children, map);
		}
	}
	return map;
}

function filterDepartmentTree(nodes: AoneDepartmentTreeNode[], query: string): AoneDepartmentTreeNode[] {
	if (!query.trim()) {
		return nodes;
	}
	const q = query.trim().toLowerCase();
	const filtered: AoneDepartmentTreeNode[] = [];
	for (const node of nodes) {
		const children = node.children ? filterDepartmentTree(node.children, query) : [];
		const selfMatch =
			node.name.toLowerCase().includes(q) || (node.full_path ?? "").toLowerCase().includes(q) || String(node.dept_id).includes(q);
		if (selfMatch || children.length > 0) {
			filtered.push({ ...node, children });
		}
	}
	return filtered;
}

function findNodePath(tree: AoneDepartmentTreeNode[], deptId: number, trail: number[] = []): number[] | null {
	for (const node of tree) {
		const nextTrail = [...trail, node.dept_id];
		if (node.dept_id === deptId) {
			return nextTrail;
		}
		if (node.children?.length) {
			const found = findNodePath(node.children, deptId, nextTrail);
			if (found) {
				return found;
			}
		}
	}
	return null;
}

function flattenDepartmentTree(nodes: AoneDepartmentTreeNode[]): AoneDepartmentTreeNode[] {
	const out: AoneDepartmentTreeNode[] = [];
	const walk = (items: AoneDepartmentTreeNode[]) => {
		for (const node of items) {
			out.push(node);
			if (node.children?.length) {
				walk(node.children);
			}
		}
	};
	walk(nodes);
	return out;
}

function getCascaderColumns(tree: AoneDepartmentTreeNode[], activePath: number[]): AoneDepartmentTreeNode[][] {
	const columns: AoneDepartmentTreeNode[][] = [];
	let level = tree;
	columns.push(level);
	for (const deptId of activePath) {
		const node = level.find((item) => item.dept_id === deptId);
		if (!node?.children?.length) {
			break;
		}
		level = node.children;
		columns.push(level);
	}
	return columns;
}

function DepartmentCascaderPanel({
	tree,
	value,
	onChange,
}: {
	tree: AoneDepartmentTreeNode[];
	value: string[];
	onChange: (next: string[]) => void;
}) {
	const [activePath, setActivePath] = useState<number[]>([]);
	const scrollRef = useRef<HTMLDivElement>(null);
	const prevColumnCountRef = useRef(0);
	const columns = useMemo(() => getCascaderColumns(tree, activePath), [activePath, tree]);

	useEffect(() => {
		const container = scrollRef.current;
		if (!container) {
			return;
		}
		if (columns.length > prevColumnCountRef.current) {
			requestAnimationFrame(() => {
				container.scrollTo({ left: container.scrollWidth, behavior: "smooth" });
			});
		}
		prevColumnCountRef.current = columns.length;
	}, [columns.length]);

	useEffect(() => {
		if (activePath.length > 0 || value.length === 0) {
			return;
		}
		const firstSelected = Number(value[0]);
		if (!Number.isFinite(firstSelected)) {
			return;
		}
		const path = findNodePath(tree, firstSelected);
		if (path && path.length > 1) {
			setActivePath(path.slice(0, -1));
		}
	}, [activePath.length, tree, value]);

	const handleToggle = (deptId: string, checked: boolean) => {
		if (checked) {
			onChange(Array.from(new Set([...value, deptId])));
			return;
		}
		onChange(value.filter((id) => id !== deptId));
	};

	const handleNavigate = (columnIndex: number, deptId: number, hasChildren: boolean) => {
		const nextPath = [...activePath.slice(0, columnIndex), deptId];
		setActivePath(hasChildren ? nextPath : nextPath.slice(0, -1));
	};

	return (
		<div
			ref={scrollRef}
			className="w-full touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain"
			data-testid="aone-dept-cascader-scroll"
		>
			<div className="inline-flex h-64 divide-x rounded-md border" data-testid="aone-dept-cascader">
				{columns.map((column, columnIndex) => (
					<div key={`cascader-col-${columnIndex}`} className="box-border flex h-64 w-[9.5rem] shrink-0 flex-col overflow-hidden">
						<div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-1">
							{column.map((node) => {
								const deptId = String(node.dept_id);
								const checked = value.includes(deptId);
								const hasChildren = (node.children?.length ?? 0) > 0;
								const isActive = activePath[columnIndex] === node.dept_id;
								return (
									<div
										key={node.dept_id}
										className={cn("hover:bg-muted/60 flex items-start gap-1 rounded-md px-1 py-1", isActive && "bg-muted/80")}
										data-testid={`aone-dept-node-${deptId}`}
									>
										<Checkbox
											checked={checked}
											onCheckedChange={(next) => handleToggle(deptId, Boolean(next))}
											className="mt-0.5 ml-1 shrink-0"
										/>
										<button
											type="button"
											title={node.name}
											className="flex min-w-0 flex-1 items-start gap-1 px-1 py-0.5 text-left"
											onClick={() => handleNavigate(columnIndex, node.dept_id, hasChildren)}
										>
											<span className="line-clamp-2 text-sm leading-snug">{node.name}</span>
											{hasChildren ? <ChevronRight className="text-muted-foreground mt-0.5 size-4 shrink-0" /> : null}
										</button>
									</div>
								);
							})}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

export function AoneDepartmentTreeSelect({
	value,
	onChange,
	disabled,
}: {
	value: string[];
	onChange: (next: string[]) => void;
	disabled?: boolean;
}) {
	const t = useT();
	const { data, isLoading } = useGetAoneDepartmentTreeQuery();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	const tree = data?.departments ?? [];
	const labelMap = useMemo(() => collectDepartmentLabels(tree), [tree]);
	const filteredTree = useMemo(() => filterDepartmentTree(tree, search), [search, tree]);

	const handleToggle = (deptId: string, checked: boolean) => {
		if (checked) {
			onChange(Array.from(new Set([...value, deptId])));
			return;
		}
		onChange(value.filter((id) => id !== deptId));
	};

	return (
		<div className="grid gap-2" data-testid="marketplace-assign-departments">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="outline"
						disabled={disabled}
						className={cn("h-auto min-h-8 w-full justify-between font-normal", value.length === 0 && "text-muted-foreground")}
					>
						<span>
							{value.length > 0
								? t("marketplace.assignments.departmentsSelected", { count: value.length })
								: t("marketplace.assignments.departmentsPlaceholder")}
						</span>
						<ChevronDown className="size-4 shrink-0 opacity-60" />
					</Button>
				</PopoverTrigger>
				<PopoverContent
					align="start"
					side="bottom"
					collisionPadding={16}
					noPortal
					className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
				>
					<div className="border-b p-2">
						<div className="relative">
							<Search className="text-muted-foreground absolute top-1/2 left-2 size-4 -translate-y-1/2" />
							<Input
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder={t("marketplace.assignments.departmentsSearch")}
								className="h-8 pl-8"
								data-testid="aone-dept-tree-search"
							/>
						</div>
						<p className="text-muted-foreground mt-2 px-1 text-xs">{t("marketplace.assignments.departmentsCascaderHint")}</p>
					</div>
					<div className="p-2">
						{isLoading ? (
							<p className="text-muted-foreground px-2 py-4 text-sm">{t("marketplace.assignments.departmentsLoading")}</p>
						) : null}
						{!isLoading && filteredTree.length === 0 ? (
							<p className="text-muted-foreground px-2 py-4 text-sm">{t("marketplace.assignments.departmentsEmpty")}</p>
						) : null}
						{!isLoading && filteredTree.length > 0 && !search.trim() ? (
							<DepartmentCascaderPanel tree={filteredTree} value={value} onChange={onChange} />
						) : null}
						{!isLoading && filteredTree.length > 0 && search.trim() ? (
							<ScrollArea className="max-h-72">
								<div className="space-y-1 p-1">
									{flattenDepartmentTree(filteredTree).map((node) => {
										const deptId = String(node.dept_id);
										return (
											<label
												key={`search-${deptId}`}
												className="hover:bg-muted/60 flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5"
											>
												<Checkbox
													checked={value.includes(deptId)}
													onCheckedChange={(next) => handleToggle(deptId, Boolean(next))}
													className="mt-0.5"
												/>
												<div className="min-w-0">
													<p className="truncate text-sm">{node.name}</p>
													{node.full_path && node.full_path !== node.name ? (
														<p className="text-muted-foreground truncate text-xs">{node.full_path}</p>
													) : null}
												</div>
											</label>
										);
									})}
								</div>
							</ScrollArea>
						) : null}
					</div>
				</PopoverContent>
			</Popover>
			{value.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{value.map((deptId) => (
						<Badge key={deptId} variant="secondary" className="gap-1 pr-1">
							<span className="max-w-56 truncate">{labelMap.get(deptId) ?? deptId}</span>
							<button
								type="button"
								className="hover:bg-background/60 rounded p-0.5"
								onClick={() => handleToggle(deptId, false)}
								aria-label="Remove"
							>
								<X className="size-3" />
							</button>
						</Badge>
					))}
				</div>
			) : null}
		</div>
	);
}