import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelMultiselect } from "@/components/ui/modelMultiselect";
import { MultiSelect } from "@/components/ui/multiSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ProviderIconType, RenderProviderIcon } from "@/lib/constants/icons";
import { getProviderLabel } from "@/lib/constants/logs";
import { getErrorMessage } from "@/lib/store";
import { useGetVirtualKeysQuery } from "@/lib/store/apis/governanceApi";
import { useGetProvidersQuery } from "@/lib/store/apis/providersApi";
import { useCreateUserGroupMutation, useUpdateUserGroupMutation } from "@/lib/store/apis/userGroupsApi";
import { CreateUserGroupRequest, UserGroup, UserGroupTierInput } from "@/lib/types/userGroups";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const TOKENS_PER_M = 1_000_000;
const ANY_PROVIDER = "__any_provider__";
const DEFAULT_SHORT_RESET = "5h";
const DEFAULT_WEEKLY_RESET = "1w";

interface UserGroupSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editingGroup?: UserGroup | null;
}

interface MappingForm {
	source_provider: string;
	source_model: string;
	target_provider: string;
	target_model: string;
}

interface TierForm {
	order: number;
	threshold_pct: number;
	is_terminal: boolean;
	fallbacks: string;
	mappings: MappingForm[];
}

function emptyMapping(): MappingForm {
	return { source_provider: "", source_model: "", target_provider: "", target_model: "" };
}

function emptyTier(order: number): TierForm {
	return { order, threshold_pct: 0, is_terminal: false, fallbacks: "", mappings: [emptyMapping()] };
}

function tokensToMillions(tokens: number | undefined): string {
	if (!tokens) return "";
	const millions = tokens / TOKENS_PER_M;
	if (Number.isInteger(millions)) return String(millions);
	return millions.toFixed(3).replace(/\.?0+$/, "");
}

function millionsToTokens(value: string): number | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const millions = Number(trimmed);
	if (Number.isNaN(millions) || millions <= 0) return undefined;
	const tokens = Math.round(millions * TOKENS_PER_M);
	if (tokens <= 0) return undefined;
	return tokens;
}

function toTierForms(group?: UserGroup | null): TierForm[] {
	if (!group?.tiers?.length) return [emptyTier(1)];
	return group.tiers.map((t) => ({
		order: t.order,
		threshold_pct: t.threshold_pct,
		is_terminal: t.is_terminal,
		fallbacks: (t.fallbacks ?? []).join(", "),
		mappings: (t.mappings ?? []).map((m) => ({
			source_provider: m.source_provider ?? "",
			source_model: m.source_model,
			target_provider: m.target_provider ?? "",
			target_model: m.target_model,
		})),
	}));
}

interface ProviderSelectProps {
	value: string;
	onChange: (value: string) => void;
	providers: string[];
	placeholder: string;
	allowAny?: boolean;
	anyLabel?: string;
	testId?: string;
}

function ProviderSelect({ value, onChange, providers, placeholder, allowAny, anyLabel = "Any provider", testId }: ProviderSelectProps) {
	return (
		<Select
			value={allowAny && !value ? ANY_PROVIDER : value || undefined}
			onValueChange={(next) => onChange(next === ANY_PROVIDER ? "" : next)}
		>
			<SelectTrigger className="h-9 w-full min-w-0 text-sm" data-testid={testId}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{allowAny && <SelectItem value={ANY_PROVIDER}>{anyLabel}</SelectItem>}
				{providers.map((prov) => (
					<SelectItem key={prov} value={prov}>
						<div className="flex items-center gap-2">
							<RenderProviderIcon provider={prov as ProviderIconType} size="sm" className="h-4 w-4 shrink-0" />
							<span className="truncate">{getProviderLabel(prov)}</span>
						</div>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

interface TierMappingRowProps {
	mapping: MappingForm;
	providers: string[];
	onChange: (patch: Partial<MappingForm>) => void;
	onRemove: () => void;
}

function TierMappingRow({ mapping, providers, onChange, onRemove }: TierMappingRowProps) {
	return (
		<div className="flex items-end gap-1">
			<div className="min-w-0 flex-1 space-y-1">
				<Label className="text-xs">Source provider</Label>
				<ProviderSelect
					value={mapping.source_provider}
					onChange={(source_provider) => onChange({ source_provider, source_model: "" })}
					providers={providers}
					placeholder="Any provider"
					allowAny
				/>
			</div>
			<div className="min-w-0 flex-1 space-y-1">
				<Label className="text-xs">Source model</Label>
				<ModelMultiselect
					key={`source-model-${mapping.source_provider || "any"}`}
					isSingleSelect
					provider={mapping.source_provider || undefined}
					value={mapping.source_model}
					onChange={(source_model) => onChange({ source_model })}
					placeholder={mapping.source_provider ? "Select model" : "Any model or select provider"}
					allowAllOption
					allowAllOptionWithoutProvider
					className="!h-9 !min-h-9"
					menuPosition="fixed"
				/>
			</div>
			<span className="text-muted-foreground shrink-0 px-0.5 pb-2 text-xs leading-none">→</span>
			<div className="min-w-0 flex-1 space-y-1">
				<Label className="text-xs">Target provider</Label>
				<ProviderSelect
					value={mapping.target_provider}
					onChange={(target_provider) => onChange({ target_provider, target_model: "" })}
					providers={providers}
					placeholder="Keep incoming"
					allowAny
					anyLabel="Keep incoming"
				/>
			</div>
			<div className="min-w-0 flex-[1.15] space-y-1">
				<Label className="text-xs">Target model</Label>
				{mapping.target_provider ? (
					<ModelMultiselect
						key={`target-model-${mapping.target_provider}`}
						isSingleSelect
						provider={mapping.target_provider}
						value={mapping.target_model}
						onChange={(target_model) => onChange({ target_model })}
						placeholder="Select model"
						className="!h-9 !min-h-9"
						menuPosition="fixed"
					/>
				) : (
					<Input
						value={mapping.target_model}
						onChange={(e) => onChange({ target_model: e.target.value })}
						placeholder="e.g. gpt-4o-mini (keeps incoming provider)"
						className="h-9"
					/>
				)}
			</div>
			<Button type="button" variant="ghost" size="icon" className="mb-0.5 shrink-0" onClick={onRemove}>
				<Trash2 className="h-3.5 w-3.5" />
			</Button>
		</div>
	);
}

export function UserGroupSheet({ open, onOpenChange, editingGroup }: UserGroupSheetProps) {
	const isEdit = !!editingGroup;

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [color, setColor] = useState("#6366f1");
	const [enabled, setEnabled] = useState(true);
	const [shortLimitM, setShortLimitM] = useState("");
	const [shortReset, setShortReset] = useState(DEFAULT_SHORT_RESET);
	const [weeklyLimitM, setWeeklyLimitM] = useState("");
	const [weeklyReset, setWeeklyReset] = useState(DEFAULT_WEEKLY_RESET);
	const [calendarAligned, setCalendarAligned] = useState(false);
	const [tiers, setTiers] = useState<TierForm[]>([emptyTier(1)]);
	const [memberIds, setMemberIds] = useState<string[]>([]);

	const { data: vkData } = useGetVirtualKeysQuery({ limit: 500, offset: 0 });
	const { data: providersData = [] } = useGetProvidersQuery();
	const providers = useMemo(() => providersData.map((p) => p.name), [providersData]);
	const vkOptions = useMemo(() => (vkData?.virtual_keys ?? []).map((vk) => ({ label: vk.name, value: vk.id })), [vkData]);

	const [createGroup, { isLoading: isCreating }] = useCreateUserGroupMutation();
	const [updateGroup, { isLoading: isUpdating }] = useUpdateUserGroupMutation();
	const isSaving = isCreating || isUpdating;

	useEffect(() => {
		if (!open) return;
		if (editingGroup) {
			setName(editingGroup.name ?? "");
			setDescription(editingGroup.description ?? "");
			setColor(editingGroup.color || "#6366f1");
			setEnabled(editingGroup.enabled !== false);
			setShortLimitM(tokensToMillions(editingGroup.short_window_token_limit));
			setShortReset(editingGroup.short_window_reset_duration || DEFAULT_SHORT_RESET);
			setWeeklyLimitM(tokensToMillions(editingGroup.weekly_window_token_limit));
			setWeeklyReset(editingGroup.weekly_window_reset_duration || DEFAULT_WEEKLY_RESET);
			setCalendarAligned(!!editingGroup.calendar_aligned);
			setTiers(toTierForms(editingGroup));
			setMemberIds((editingGroup.members ?? []).map((m) => m.virtual_key_id));
		} else {
			setName("");
			setDescription("");
			setColor("#6366f1");
			setEnabled(true);
			setShortLimitM("");
			setShortReset(DEFAULT_SHORT_RESET);
			setWeeklyLimitM("");
			setWeeklyReset(DEFAULT_WEEKLY_RESET);
			setCalendarAligned(false);
			setTiers([emptyTier(1)]);
			setMemberIds([]);
		}
	}, [open, editingGroup]);

	const updateTier = (idx: number, patch: Partial<TierForm>) => {
		setTiers((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
	};

	const updateMapping = (tierIdx: number, mapIdx: number, patch: Partial<MappingForm>) => {
		setTiers((prev) =>
			prev.map((t, i) => (i === tierIdx ? { ...t, mappings: t.mappings.map((m, j) => (j === mapIdx ? { ...m, ...patch } : m)) } : t)),
		);
	};

	const addTier = () => setTiers((prev) => [...prev, emptyTier(prev.length + 1)]);
	const removeTier = (idx: number) => setTiers((prev) => prev.filter((_, i) => i !== idx));
	const addMapping = (tierIdx: number) =>
		setTiers((prev) => prev.map((t, i) => (i === tierIdx ? { ...t, mappings: [...t.mappings, emptyMapping()] } : t)));
	const removeMapping = (tierIdx: number, mapIdx: number) =>
		setTiers((prev) => prev.map((t, i) => (i === tierIdx ? { ...t, mappings: t.mappings.filter((_, j) => j !== mapIdx) } : t)));

	const buildPayload = (): CreateUserGroupRequest => {
		const shortLimitInput = shortLimitM.trim();
		const weeklyLimitInput = weeklyLimitM.trim();
		const shortTokens = shortLimitInput ? millionsToTokens(shortLimitInput) : undefined;
		const weeklyTokens = weeklyLimitInput ? millionsToTokens(weeklyLimitInput) : undefined;
		const shortResetDuration = shortReset.trim() || DEFAULT_SHORT_RESET;
		const weeklyResetDuration = weeklyReset.trim() || DEFAULT_WEEKLY_RESET;

		const tierInputs: UserGroupTierInput[] = tiers.map((t) => ({
			order: t.order,
			threshold_pct: t.threshold_pct,
			is_terminal: t.is_terminal,
			fallbacks: t.fallbacks
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean),
			mappings: t.mappings
				.filter((m) => m.source_model.trim() && m.target_model.trim())
				.map((m) => ({
					source_provider: m.source_provider.trim() || undefined,
					source_model: m.source_model.trim(),
					target_provider: m.target_provider.trim() || undefined,
					target_model: m.target_model.trim(),
				})),
		}));

		return {
			name: name.trim(),
			description: description.trim() || undefined,
			color: color || undefined,
			enabled,
			short_window_token_limit: shortTokens,
			short_window_reset_duration: shortTokens !== undefined ? shortResetDuration : undefined,
			weekly_window_token_limit: weeklyTokens,
			weekly_window_reset_duration: weeklyTokens !== undefined ? weeklyResetDuration : undefined,
			calendar_aligned: calendarAligned,
			tiers: tierInputs,
			virtual_key_ids: memberIds,
		};
	};

	const handleSave = async () => {
		if (!name.trim()) {
			toast.error("Name is required");
			return;
		}
		if (shortLimitM.trim() && millionsToTokens(shortLimitM) === undefined) {
			toast.error("Short window token limit must be a positive number (in millions)");
			return;
		}
		if (weeklyLimitM.trim() && millionsToTokens(weeklyLimitM) === undefined) {
			toast.error("Weekly window token limit must be a positive number (in millions)");
			return;
		}
		const payload = buildPayload();
		try {
			if (isEdit && editingGroup) {
				await updateGroup({ id: editingGroup.id, data: payload }).unwrap();
				toast.success("User group updated");
			} else {
				await createGroup(payload).unwrap();
				toast.success("User group created");
			}
			onOpenChange(false);
		} catch (err) {
			toast.error(getErrorMessage(err));
		}
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 pt-4 sm:max-w-4xl">
				<SheetHeader className="flex shrink-0 flex-col items-start px-6 py-3" headerClassName="mb-0">
					<SheetTitle className="text-base">{isEdit ? "Edit User Group" : "Create User Group"}</SheetTitle>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col space-y-6 overflow-y-auto px-6 pb-6">
					<div className="space-y-3">
						<div className="space-y-1.5">
							<Label htmlFor="ug-name">Name</Label>
							<Input
								id="ug-name"
								data-testid="user-group-name-input"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. high-consumption"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="ug-desc">Description</Label>
							<Textarea id="ug-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
						</div>
						<div className="flex flex-wrap items-center gap-4">
							<div className="space-y-1.5">
								<Label htmlFor="ug-color">Color</Label>
								<Input id="ug-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-16 p-1" />
							</div>
							<div className="flex items-center gap-2 pt-5">
								<Switch checked={enabled} onCheckedChange={setEnabled} id="ug-enabled" />
								<Label htmlFor="ug-enabled">Enabled</Label>
							</div>
							<div className="flex items-center gap-2 pt-5">
								<Switch checked={calendarAligned} onCheckedChange={setCalendarAligned} id="ug-cal" />
								<Label htmlFor="ug-cal">Calendar aligned</Label>
							</div>
						</div>
					</div>

					<Separator />

					<div className="space-y-3">
						<h3 className="text-sm font-semibold">Usage windows</h3>
						<p className="text-muted-foreground text-xs">
							Per-user token consumption is measured against these windows. Limits are entered in millions of tokens (M). The higher window
							usage % drives the active tier.
						</p>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label>Short window token limit (M)</Label>
								<Input
									type="number"
									min={0}
									step={0.1}
									value={shortLimitM}
									data-testid="user-group-short-limit"
									onChange={(e) => setShortLimitM(e.target.value)}
									placeholder="e.g. 0.5"
								/>
							</div>
							<div className="space-y-1.5">
								<Label>Short window reset</Label>
								<Input value={shortReset} onChange={(e) => setShortReset(e.target.value)} placeholder={DEFAULT_SHORT_RESET} />
							</div>
							<div className="space-y-1.5">
								<Label>Weekly window token limit (M)</Label>
								<Input
									type="number"
									min={0}
									step={0.1}
									value={weeklyLimitM}
									data-testid="user-group-weekly-limit"
									onChange={(e) => setWeeklyLimitM(e.target.value)}
									placeholder="e.g. 5"
								/>
							</div>
							<div className="space-y-1.5">
								<Label>Weekly window reset</Label>
								<Input value={weeklyReset} onChange={(e) => setWeeklyReset(e.target.value)} placeholder={DEFAULT_WEEKLY_RESET} />
							</div>
						</div>
					</div>

					<Separator />

					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-semibold">Degradation tiers</h3>
							<Button type="button" variant="outline" size="sm" onClick={addTier} data-testid="user-group-add-tier">
								<Plus className="mr-1 h-4 w-4" /> Add tier
							</Button>
						</div>
						{tiers.map((tier, tierIdx) => (
							<div key={tierIdx} className="space-y-3 rounded-md border p-3">
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium">Tier {tier.order}</span>
									<Button type="button" variant="ghost" size="icon" onClick={() => removeTier(tierIdx)}>
										<Trash2 className="text-destructive h-4 w-4" />
									</Button>
								</div>
								<div className="grid grid-cols-3 items-end gap-3">
									<div className="space-y-1.5">
										<Label>Order</Label>
										<Input type="number" value={tier.order} onChange={(e) => updateTier(tierIdx, { order: Number(e.target.value) })} />
									</div>
									<div className="space-y-1.5">
										<Label>Threshold %</Label>
										<Input
											type="number"
											value={tier.threshold_pct}
											onChange={(e) => updateTier(tierIdx, { threshold_pct: Number(e.target.value) })}
											placeholder="0-100"
										/>
									</div>
									<div className="flex items-center gap-2 pb-2">
										<Switch
											checked={tier.is_terminal}
											onCheckedChange={(v) => updateTier(tierIdx, { is_terminal: v })}
											id={`terminal-${tierIdx}`}
										/>
										<Label htmlFor={`terminal-${tierIdx}`}>Terminal</Label>
									</div>
								</div>

								<div className="space-y-2">
									<div className="flex items-center justify-between">
										<Label className="text-xs">Model substitutions (source → target)</Label>
										<Button type="button" variant="ghost" size="sm" onClick={() => addMapping(tierIdx)}>
											<Plus className="mr-1 h-3 w-3" /> Add
										</Button>
									</div>
									<p className="text-muted-foreground text-xs">
										Select a source provider to restrict the source model list to that provider. Leave provider as &quot;Any&quot; and
										choose &quot;All Models&quot; (*) to match every model. For target, pick a target provider to search its catalog, or
										leave provider as &quot;Keep incoming&quot; and type the downgraded model name manually.
									</p>
									<div className="space-y-2">
										{tier.mappings.map((m, mapIdx) => (
											<TierMappingRow
												key={mapIdx}
												mapping={m}
												providers={providers}
												onChange={(patch) => updateMapping(tierIdx, mapIdx, patch)}
												onRemove={() => removeMapping(tierIdx, mapIdx)}
											/>
										))}
									</div>
								</div>

								{tier.is_terminal && (
									<div className="space-y-1.5">
										<Label className="text-xs">Fallbacks (comma-separated provider/model)</Label>
										<Input
											value={tier.fallbacks}
											onChange={(e) => updateTier(tierIdx, { fallbacks: e.target.value })}
											placeholder="openai/gpt-4o-mini, groq/llama-3.1-8b"
										/>
									</div>
								)}
							</div>
						))}
					</div>

					<Separator />

					<div className="space-y-2">
						<h3 className="text-sm font-semibold">Members (users)</h3>
						<MultiSelect options={vkOptions} onValueChange={setMemberIds} defaultValue={memberIds} placeholder="Select users" />
					</div>
				</div>

				<div className="bg-background flex shrink-0 justify-end gap-2 border-t p-4">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={isSaving} data-testid="user-group-save-btn">
						{isSaving ? "Saving..." : isEdit ? "Save changes" : "Create group"}
					</Button>
				</div>
			</SheetContent>
		</Sheet>
	);
}