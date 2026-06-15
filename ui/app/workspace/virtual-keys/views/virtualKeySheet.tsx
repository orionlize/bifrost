import { useVirtualKeyUsage } from "@/app/workspace/virtual-keys/hooks/useVirtualKeyUsage";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alertDialog";
import { AsyncMultiSelect } from "@/components/ui/asyncMultiselect";
import { Button } from "@/components/ui/button";
import { ComboboxSelect } from "@/components/ui/combobox";
import { ConfigSyncAlert } from "@/components/ui/configSyncAlert";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelMultiselect } from "@/components/ui/modelMultiselect";
import MultiBudgetLines from "@/components/ui/multibudgets";
import { MultiSelect } from "@/components/ui/multiSelect";
import NumberAndSelect from "@/components/ui/numberAndSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DottedSeparator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import Toggle from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/components/ui/utils";
import { ModelPlaceholders } from "@/lib/constants/config";
import { resetDurationOptions, supportsCalendarAlignment } from "@/lib/constants/governance";
import { ProviderIconType, RenderProviderIcon } from "@/lib/constants/icons";
import { ProviderLabels, ProviderName } from "@/lib/constants/logs";
import {
	getErrorMessage,
	useCreateVirtualKeyMutation,
	useGetAllKeysQuery,
	useGetMCPClientsQuery,
	useGetProvidersQuery,
	useRotateVirtualKeyMutation,
	useUpdateVirtualKeyMutation,
} from "@/lib/store";
import { KnownProvider } from "@/lib/types/config";
import { CreateVirtualKeyRequest, Customer, Team, UpdateVirtualKeyRequest, VirtualKey } from "@/lib/types/governance";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "@tanstack/react-router";
import { Info, Lock, RotateCcw, Trash2, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { components, MultiValueProps, OptionProps } from "react-select";
import { toast } from "sonner";
import { useT, type TranslateFn } from "@/lib/i18n";
import { z } from "zod";

interface VirtualKeySheetProps {
	virtualKey?: VirtualKey | null;
	teams: Team[];
	customers: Customer[];
	// When set, the new VK is created under this team. The entity assignment is pre-set
	// and cannot be changed (but all other fields remain editable).
	defaultTeamId?: string;
	onSave: () => void;
	onCancel: () => void;
}

// Provider configuration schema
const createVirtualKeyFormSchema = (t: TranslateFn) => {
	const providerConfigSchema = z.object({
		id: z.number().optional(),
		provider: z.string().min(1, t("virtualKeys.validationProviderRequired")),
		weight: z.number().min(0, t("virtualKeys.validationWeightMin")).max(1, t("virtualKeys.validationWeightMax")).optional(),
		allowed_models: z.array(z.string()).optional(),
		blacklisted_models: z.array(z.string()).optional(),
		key_ids: z.array(z.string()).optional(), // Keys associated with this provider config
		// Provider-level budget
		budgets: z
			.array(
				z.object({
					id: z.string().optional(),
					max_limit: z.number().nonnegative().optional(),
					reset_duration: z.string().optional(),
				}),
			)
			.optional(),
		// Provider-level rate limits
		rate_limit: z
			.object({
				token_max_limit: z.number().int().nonnegative().optional(),
				token_reset_duration: z.string().optional(),
				request_max_limit: z.number().int().nonnegative().optional(),
				request_reset_duration: z.string().optional(),
			})
			.optional(),
	});

	const mcpConfigSchema = z.object({
		id: z.number().optional(),
		mcp_client_name: z.string().min(1, t("virtualKeys.validationMcpRequired")),
		tools_to_execute: z.array(z.string()).optional(),
	});

	// Main form schema
	const formSchema = z
		.object({
			name: z.string().min(1, t("virtualKeys.validationNameRequired")),
			description: z.string().optional(),
			providerConfigs: z.array(providerConfigSchema).optional(),
			mcpConfigs: z.array(mcpConfigSchema).optional(),
			entityType: z.enum(["team", "customer", "none"]),
			teamId: z.string().optional(),
			customerId: z.string().optional(),
			isActive: z.boolean(),
			// Budget
			budgetCalendarAligned: z.boolean(),
			budgets: z
				.array(
					z.object({
						id: z.string().optional(),
						max_limit: z.number().nonnegative().optional(),
						reset_duration: z.string(),
					}),
				)
				.optional(),
			// Token limits
			tokenMaxLimit: z.number().int().nonnegative().optional(),
			tokenResetDuration: z.string().optional(),
			// Request limits
			requestMaxLimit: z.number().int().nonnegative().optional(),
			requestResetDuration: z.string().optional(),
		})
		.refine(
			(data) => {
				// If entityType is "team", teamId must be provided and not empty
				if (data.entityType === "team") {
					return data.teamId && data.teamId.trim() !== "";
				}
				// If entityType is "customer", customerId must be provided and not empty
				if (data.entityType === "customer") {
					return data.customerId && data.customerId.trim() !== "";
				}
				return true;
			},
			{
				message: t("virtualKeys.validationEntity"),
				path: ["entityType"], // This will show the error on the entityType field
			},
		);
	return formSchema;
};

type FormData = z.infer<ReturnType<typeof createVirtualKeyFormSchema>>;
type BudgetComparisonEntry = {
	id?: string;
	max_limit?: number;
	reset_duration?: string;
	current_usage?: number;
};

type VirtualKeyType = {
	label: string;
	value: string;
	description: string;
	provider: string;
};

export default function VirtualKeySheet({ virtualKey, teams, customers, defaultTeamId, onSave, onCancel }: VirtualKeySheetProps) {
	const t = useT();
	const formSchema = useMemo(() => createVirtualKeyFormSchema(t), [t]);
	const [isOpen, setIsOpen] = useState(true);
	const navigate = useNavigate();
	const isEditing = !!virtualKey;

	const hasCreateAccess = useRbac(RbacResource.VirtualKeys, RbacOperation.Create);
	const hasUpdateAccess = useRbac(RbacResource.VirtualKeys, RbacOperation.Update);
	const canSubmit = isEditing ? hasUpdateAccess : hasCreateAccess;

	// Detect AP-managed status via the managing profile's virtual_key_ids, not just by the presence
	// of assignees — directly-attached users don't imply an access-profile relation.
	const { assignedUsers, isManagedByProfile: isManagedByProfileHook } = useVirtualKeyUsage(virtualKey);
	const isManagedByProfile = isEditing && isManagedByProfileHook;
	// Team attachment: when creating from a team context (defaultTeamId provided), the entity
	// assignment is pre-set and locked. When editing an existing VK the assignment can be changed.
	const attachedTeamId = isEditing ? virtualKey?.team_id || "" : defaultTeamId || "";
	const attachedTeam = attachedTeamId ? teams.find((team) => team.id === attachedTeamId) : undefined;
	const isTeamLocked = !isEditing && !!defaultTeamId;

	const handleClose = () => {
		setIsOpen(false);
		setTimeout(() => {
			onCancel();
		}, 150); // Slightly longer than the 100ms animation duration
	};

	// RTK Query hooks
	const { data: providersData, error: providersError } = useGetProvidersQuery();
	const { data: keysData, error: keysError } = useGetAllKeysQuery();
	const [createVirtualKey, { isLoading: isCreating }] = useCreateVirtualKeyMutation();
	const [updateVirtualKey, { isLoading: isUpdating }] = useUpdateVirtualKeyMutation();
	const [rotateVirtualKey, { isLoading: isRotating }] = useRotateVirtualKeyMutation();
	const { data: mcpClientsResponse, error: mcpClientsError } = useGetMCPClientsQuery();
	const mcpClientsData = mcpClientsResponse?.clients || [];
	const isLoading = isCreating || isUpdating || isRotating;

	const availableKeys = keysData || [];
	const availableProviders = providersData || [];

	// Form setup
	const form = useForm<z.input<typeof formSchema>, unknown, FormData>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			name: virtualKey?.name || "",
			description: virtualKey?.description || "",
			providerConfigs:
				virtualKey?.provider_configs?.map((config) => ({
					id: config.id,
					provider: config.provider,
					weight: config.weight ?? undefined,
					allowed_models: config.allowed_models || [],
					blacklisted_models: config.blacklisted_models || [],
					key_ids: config.allow_all_keys ? ["*"] : config.keys?.map((key) => key.key_id) || [],
					budgets: config.budgets?.map((b) => ({
						id: b.id,
						max_limit: b.max_limit,
						reset_duration: b.reset_duration,
					})),
					rate_limit: config.rate_limit
						? {
								token_max_limit: config.rate_limit.token_max_limit ?? undefined,
								token_reset_duration: config.rate_limit.token_reset_duration,
								request_max_limit: config.rate_limit.request_max_limit ?? undefined,
								request_reset_duration: config.rate_limit.request_reset_duration,
							}
						: undefined,
				})) || [],
			mcpConfigs:
				virtualKey?.mcp_configs?.map((config) => ({
					id: config.id,
					mcp_client_name: config.mcp_client?.name || "",
					tools_to_execute: config.tools_to_execute || [],
				})) || [],
			entityType: virtualKey?.team_id ? "team" : virtualKey?.customer_id ? "customer" : !isEditing && defaultTeamId ? "team" : "none",
			teamId: virtualKey?.team_id || (!isEditing ? defaultTeamId || "" : ""),
			customerId: virtualKey?.customer_id || "",
			isActive: virtualKey?.is_active ?? true,
			budgets:
				virtualKey?.budgets && virtualKey.budgets.length > 0
					? virtualKey.budgets.map((b) => ({
							id: b.id,
							max_limit: b.max_limit,
							reset_duration: b.reset_duration ?? "1M",
						}))
					: [],
			budgetCalendarAligned: virtualKey?.calendar_aligned ?? false,
			tokenMaxLimit: virtualKey?.rate_limit?.token_max_limit ?? undefined,
			tokenResetDuration: virtualKey?.rate_limit?.token_reset_duration || "1h",
			requestMaxLimit: virtualKey?.rate_limit?.request_max_limit ?? undefined,
			requestResetDuration: virtualKey?.rate_limit?.request_reset_duration || "1h",
		},
	});

	// Handle keys loading error
	useEffect(() => {
		if (keysError) {
			toast.error(t("virtualKeys.sheet.loadKeysFailed", { message: getErrorMessage(keysError) }));
		}
	}, [keysError]);

	// Handle providers loading error
	useEffect(() => {
		if (providersError) {
			toast.error(t("virtualKeys.sheet.loadProvidersFailed", { message: getErrorMessage(providersError) }));
		}
	}, [providersError]);

	// Handle mcp clients loading error
	useEffect(() => {
		if (mcpClientsError) {
			toast.error(t("virtualKeys.sheet.loadMcpFailed", { message: getErrorMessage(mcpClientsError) }));
		}
	}, [mcpClientsError]);

	// Clear team/customer IDs when entityType changes to "none"
	useEffect(() => {
		const entityType = form.watch("entityType");
		if (entityType === "none") {
			form.setValue("teamId", "", { shouldDirty: true });
			form.setValue("customerId", "", { shouldDirty: true });
		} else if (entityType === "team") {
			form.setValue("customerId", "", { shouldDirty: true });
		} else if (entityType === "customer") {
			form.setValue("teamId", "", { shouldDirty: true });
		}
	}, [form.watch("entityType"), form]);

	// Provider configuration state
	const [selectedProvider, setSelectedProvider] = useState<string>("");

	// MCP client configuration state
	const [selectedMCPClient, setSelectedMCPClient] = useState<string>("");

	// Get current provider configs from form
	const providerConfigs = form.watch("providerConfigs") || [];

	// Get current MCP configs from form
	const mcpConfigs = form.watch("mcpConfigs") || [];

	// Watch budget/rate-limit fields for conditional rendering of reset buttons
	const watchedBudgets = form.watch("budgets");
	const watchedTokenMaxLimit = form.watch("tokenMaxLimit");
	const watchedRequestMaxLimit = form.watch("requestMaxLimit");
	const watchedTokenResetDuration = form.watch("tokenResetDuration");
	const watchedRequestResetDuration = form.watch("requestResetDuration");
	const watchedBudgetCalendarAligned = form.watch("budgetCalendarAligned");

	// Calendar alignment is VK-wide and applies to both budgets and rate limits: show the
	// toggle when any configured budget or rate-limit uses a calendar-alignable duration.
	const hasAnyAlignableBudget =
		watchedBudgets &&
		watchedBudgets.length > 0 &&
		watchedBudgets.some((b) => b.max_limit !== undefined && b.max_limit !== null && supportsCalendarAlignment(b.reset_duration || "1M"));
	const hasAnyAlignableRateLimit =
		(watchedTokenMaxLimit !== undefined && watchedTokenMaxLimit !== null && supportsCalendarAlignment(watchedTokenResetDuration || "1h")) ||
		(watchedRequestMaxLimit !== undefined &&
			watchedRequestMaxLimit !== null &&
			supportsCalendarAlignment(watchedRequestResetDuration || "1h"));
	const showCalendarAlignToggle = hasAnyAlignableBudget || hasAnyAlignableRateLimit;

	// Handle adding a new provider configuration
	const handleAddProvider = (provider: string) => {
		const existingConfig = providerConfigs.find((config) => config.provider === provider);
		if (existingConfig) {
			toast.error(t("virtualKeys.providerAlreadyConfigured"));
			return;
		}

		const newConfig = {
			provider: provider,
			weight: undefined as number | undefined, // undefined = excluded from weighted routing until user sets a weight
			allowed_models: ["*"],
			blacklisted_models: [],
			key_ids: ["*"],
		};

		form.setValue("providerConfigs", [...providerConfigs, newConfig], {
			shouldDirty: true,
		});
	};

	// Handle removing a provider configuration
	const handleRemoveProvider = (index: number) => {
		const updatedConfigs = providerConfigs.filter((_, i) => i !== index);
		form.setValue("providerConfigs", updatedConfigs, { shouldDirty: true });
	};

	// Handle updating provider configuration
	const handleUpdateProviderConfig = (index: number, field: string, value: any) => {
		const updatedConfigs = [...providerConfigs];
		updatedConfigs[index] = { ...updatedConfigs[index], [field]: value };
		form.setValue("providerConfigs", updatedConfigs, { shouldDirty: true });
	};

	// Handle adding a new MCP client configuration
	const handleAddMCPClient = (mcpClientName: string) => {
		const existingConfig = mcpConfigs.find((config) => config.mcp_client_name === mcpClientName);
		if (existingConfig) {
			toast.error(t("virtualKeys.mcpAlreadyConfigured"));
			return;
		}

		const newConfig = {
			mcp_client_name: mcpClientName,
			tools_to_execute: ["*"],
		};

		form.setValue("mcpConfigs", [...mcpConfigs, newConfig], {
			shouldDirty: true,
		});
	};

	// Handle removing an MCP client configuration
	const handleRemoveMCPClient = (index: number) => {
		const updatedConfigs = mcpConfigs.filter((_, i) => i !== index);
		form.setValue("mcpConfigs", updatedConfigs, { shouldDirty: true });
	};

	// Handle updating MCP client configuration
	const handleUpdateMCPConfig = (index: number, field: keyof (typeof mcpConfigs)[0], value: any) => {
		const updatedConfigs = [...mcpConfigs];
		updatedConfigs[index] = { ...updatedConfigs[index], [field]: value };
		form.setValue("mcpConfigs", updatedConfigs, { shouldDirty: true });
	};

	const [showCalendarAlignWarning, setShowCalendarAlignWarning] = useState(false);
	const [showReassignTeamWarning, setShowReassignTeamWarning] = useState(false);
	const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
	const [showRotateWarning, setShowRotateWarning] = useState(false);
	const [showBudgetResetPrompt, setShowBudgetResetPrompt] = useState(false);
	const [pendingBudgetResetData, setPendingBudgetResetData] = useState<FormData | null>(null);
	const [pendingBudgetUsageWarning, setPendingBudgetUsageWarning] = useState<string | null>(null);

	const handleCalendarAlignedChange = (checked: boolean) => {
		if (checked && isEditing) {
			// Show warning when enabling on an existing VK
			setShowCalendarAlignWarning(true);
		} else {
			form.setValue("budgetCalendarAligned", checked, { shouldDirty: true });
		}
	};

	const clearVirtualKeyBudget = () => {
		form.setValue("budgets", [], { shouldDirty: true });
		form.setValue("budgetCalendarAligned", false, { shouldDirty: true });
	};

	const clearVirtualKeyRateLimits = () => {
		form.setValue("tokenMaxLimit", undefined, { shouldDirty: true });
		form.setValue("tokenResetDuration", "1h", { shouldDirty: true });
		form.setValue("requestMaxLimit", undefined, { shouldDirty: true });
		form.setValue("requestResetDuration", "1h", { shouldDirty: true });
	};

	const normalizeProviderConfigs = (configs: typeof providerConfigs, existingConfigs?: VirtualKey["provider_configs"]): any[] => {
		return configs.map((config) => ({
			...config,
			budgets: config.budgets?.filter((b): b is { id?: string; max_limit: number; reset_duration: string } => b.max_limit !== undefined),
			weight: config.weight ?? null,
			rate_limit: (() => {
				const hasTokenMaxLimit = config.rate_limit?.token_max_limit !== undefined;
				const hasRequestMaxLimit = config.rate_limit?.request_max_limit !== undefined;
				if (hasTokenMaxLimit || hasRequestMaxLimit) {
					return {
						token_max_limit: config.rate_limit?.token_max_limit ?? null,
						token_reset_duration: hasTokenMaxLimit ? config.rate_limit?.token_reset_duration || "1h" : null,
						request_max_limit: config.rate_limit?.request_max_limit ?? null,
						request_reset_duration: hasRequestMaxLimit ? config.rate_limit?.request_reset_duration || "1h" : null,
					};
				}

				const existingConfig = existingConfigs?.find((item) => (config.id ? item.id === config.id : item.provider === config.provider));
				if (existingConfig?.rate_limit) {
					return {};
				}

				return undefined;
			})(),
		}));
	};

	const budgetSignature = (budgets?: BudgetComparisonEntry[]) =>
		(budgets || [])
			.filter((budget) => budget.max_limit !== undefined)
			.map((budget) => `${budget.id ?? ""}:${budget.max_limit}:${budget.reset_duration ?? ""}`)
			.sort()
			.join("|");

	const parseResetDurationMs = (duration?: string) => {
		if (!duration) return null;
		const match = duration.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|M|Y)$/);
		if (!match) return null;
		const amount = Number(match[1]);
		const unit = match[2];
		const multipliers: Record<string, number> = {
			ms: 1,
			s: 1000,
			m: 60 * 1000,
			h: 60 * 60 * 1000,
			d: 24 * 60 * 60 * 1000,
			w: 7 * 24 * 60 * 60 * 1000,
			M: 30 * 24 * 60 * 60 * 1000,
			Y: 365 * 24 * 60 * 60 * 1000,
		};
		return amount * multipliers[unit];
	};

	const formatBudgetAmount = (value: number) =>
		new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			maximumFractionDigits: 2,
		}).format(value);

	const findBudgetUsageWarning = (
		currentBudgets: BudgetComparisonEntry[] | undefined,
		existingBudgets: BudgetComparisonEntry[] | undefined,
		scopeLabel: string,
	) => {
		const current = (currentBudgets || [])
			.filter(
				(
					budget,
				): budget is BudgetComparisonEntry & {
					max_limit: number;
					reset_duration: string;
				} => {
					return budget.max_limit !== undefined && !!budget.reset_duration;
				},
			)
			.sort((left, right) => (parseResetDurationMs(left.reset_duration) ?? 0) - (parseResetDurationMs(right.reset_duration) ?? 0));
		const existingByID = new Map((existingBudgets || []).filter((budget) => budget.id).map((budget) => [budget.id, budget]));
		const existingByDuration = new Map((existingBudgets || []).map((budget) => [budget.reset_duration, budget]));
		const reconciled: BudgetComparisonEntry[] = [];

		for (const budget of current) {
			const existing = budget.id ? existingByID.get(budget.id) : existingByDuration.get(budget.reset_duration);
			if (existing) {
				const configChanged = existing.max_limit !== budget.max_limit || existing.reset_duration !== budget.reset_duration;
				const usage = existing.current_usage ?? 0;
				if (configChanged && usage >= budget.max_limit) {
					return t("virtualKeys.sheet.budgetWarningExceeds", {
						scopeLabel,
						duration: budget.reset_duration,
						usage: formatBudgetAmount(usage),
						limit: formatBudgetAmount(budget.max_limit),
					});
				}
				reconciled.push({ ...budget, current_usage: usage });
				continue;
			}

			const targetDuration = parseResetDurationMs(budget.reset_duration);
			const closestShorter = reconciled.reduce<BudgetComparisonEntry | null>((closest, candidate) => {
				const candidateDuration = parseResetDurationMs(candidate.reset_duration);
				const closestDuration = parseResetDurationMs(closest?.reset_duration);
				if (targetDuration === null || candidateDuration === null || candidateDuration >= targetDuration) {
					return closest;
				}
				if (closest === null || closestDuration === null || candidateDuration > closestDuration) {
					return candidate;
				}
				return closest;
			}, null);
			const inheritedUsage = closestShorter?.current_usage ?? 0;
			if (inheritedUsage >= budget.max_limit) {
				return t("virtualKeys.sheet.budgetWarningInherit", {
					scopeLabel,
					duration: budget.reset_duration,
					usage: formatBudgetAmount(inheritedUsage),
					sourceDuration: closestShorter?.reset_duration ?? "",
					limit: formatBudgetAmount(budget.max_limit),
				});
			}
			reconciled.push({ ...budget, current_usage: inheritedUsage });
		}

		return null;
	};

	const getBudgetUsageWarning = (data: FormData) => {
		if (!isEditing || !virtualKey || isManagedByProfile) {
			return null;
		}

		const vkWarning = findBudgetUsageWarning(data.budgets, virtualKey.budgets, t("virtualKeys.sheet.budgetScopeUser"));
		if (vkWarning) {
			return vkWarning;
		}

		const existingProviderConfigs = new Map<string, NonNullable<VirtualKey["provider_configs"]>[number]>();
		(virtualKey.provider_configs || []).forEach((config) => {
			existingProviderConfigs.set(String(config.id ?? config.provider), config);
		});
		for (const config of data.providerConfigs || []) {
			const existingConfig = existingProviderConfigs.get(String(config.id ?? config.provider));
			const providerLabel = ProviderLabels[config.provider as ProviderName] ?? config.provider;
			const warning = findBudgetUsageWarning(
				config.budgets,
				existingConfig?.budgets,
				t("virtualKeys.sheet.budgetScopeProvider", { provider: providerLabel }),
			);
			if (warning) {
				return warning;
			}
		}

		return null;
	};

	const hasBudgetResetRelevantChanges = (data: FormData) => {
		if (!isEditing || !virtualKey || isManagedByProfile) {
			return false;
		}

		const currentBudgets = (data.budgets || []).filter(
			(budget): budget is { id?: string; max_limit: number; reset_duration: string } => budget.max_limit !== undefined,
		);
		const existingBudgets = virtualKey.budgets || [];
		const hasBudgetFields =
			currentBudgets.length > 0 ||
			existingBudgets.length > 0 ||
			(data.providerConfigs || []).some((config) => (config.budgets || []).some((budget) => budget.max_limit !== undefined)) ||
			(virtualKey.provider_configs || []).some((config) => (config.budgets || []).length > 0);

		if (budgetSignature(currentBudgets) !== budgetSignature(existingBudgets)) {
			return true;
		}

		if (hasBudgetFields && data.budgetCalendarAligned !== (virtualKey.calendar_aligned ?? false)) {
			return true;
		}

		const existingProviderConfigs = new Map<string, NonNullable<VirtualKey["provider_configs"]>[number]>();
		(virtualKey.provider_configs || []).forEach((config) => {
			existingProviderConfigs.set(String(config.id ?? config.provider), config);
		});

		const currentProviderConfigs = new Map<string, NonNullable<FormData["providerConfigs"]>[number]>();
		(data.providerConfigs || []).forEach((config) => {
			currentProviderConfigs.set(String(config.id ?? config.provider), config);
		});

		const providerConfigKeys = new Set([...existingProviderConfigs.keys(), ...currentProviderConfigs.keys()]);
		for (const key of providerConfigKeys) {
			const currentSignature = budgetSignature(currentProviderConfigs.get(key)?.budgets);
			const existingSignature = budgetSignature(existingProviderConfigs.get(key)?.budgets);
			if (currentSignature !== existingSignature) {
				return true;
			}
		}

		return false;
	};

	const handleRotateVirtualKey = async () => {
		if (!virtualKey) return;
		if (!hasUpdateAccess) {
			toast.error(t("virtualKeys.noPermission"));
			return;
		}
		try {
			await rotateVirtualKey(virtualKey.id).unwrap();
			toast.success(t("virtualKeys.rotated"));
			setShowRotateWarning(false);
			onSave();
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	const submitVirtualKeyForm = async (data: FormData, resetBudgetUsage = false) => {
		if (!canSubmit) {
			toast.error(t("virtualKeys.noPermission"));
			return;
		}
		try {
			// Managed VKs only allow name + description updates; all other fields are owned by the access profile.
			if (isManagedByProfile && virtualKey) {
				await updateVirtualKey({
					vkId: virtualKey.id,
					data: {
						name: data.name,
						description: data.description,
					},
				}).unwrap();
				toast.success(t("virtualKeys.updated"));
				onSave();
				return;
			}

			// Normalize provider configs to ensure weights are numbers and handle budget/rate limits
			const normalizedProviderConfigs = data.providerConfigs
				? normalizeProviderConfigs(data.providerConfigs, virtualKey?.provider_configs)
				: [];
			if (isEditing && virtualKey) {
				// Update existing virtual key
				const updateData: UpdateVirtualKeyRequest = {
					name: data.name,
					description: data.description,
					provider_configs: normalizedProviderConfigs,
					mcp_configs: data.mcpConfigs,
					team_id: data.entityType === "team" && data.teamId && data.teamId.trim() !== "" ? data.teamId : undefined,
					customer_id: data.entityType === "customer" && data.customerId && data.customerId.trim() !== "" ? data.customerId : undefined,
					is_active: data.isActive,
					calendar_aligned: data.budgetCalendarAligned,
					reset_budget_usage: resetBudgetUsage,
				};

				// Add budgets if enabled
				const validBudgets = (data.budgets || []).filter(
					(b): b is { id?: string; max_limit: number; reset_duration: string } => b.max_limit !== undefined,
				);
				const hadBudget = virtualKey.budgets && virtualKey.budgets.length > 0;
				if (validBudgets.length > 0) {
					updateData.budgets = validBudgets;
				} else if (hadBudget) {
					updateData.budgets = [];
				}

				// Add rate limit if enabled
				const hadRateLimit = !!virtualKey.rate_limit;
				const hasTokenMaxLimit = data.tokenMaxLimit !== undefined;
				const hasRequestMaxLimit = data.requestMaxLimit !== undefined;
				const hasRateLimit = hasTokenMaxLimit || hasRequestMaxLimit;
				if (hasRateLimit) {
					updateData.rate_limit = {
						token_max_limit: data.tokenMaxLimit ?? null,
						token_reset_duration: hasTokenMaxLimit ? data.tokenResetDuration || "1h" : null,
						request_max_limit: data.requestMaxLimit ?? null,
						request_reset_duration: hasRequestMaxLimit ? data.requestResetDuration || "1h" : null,
					};
				} else if (hadRateLimit) {
					updateData.rate_limit = {};
				}

				await updateVirtualKey({
					vkId: virtualKey.id,
					data: updateData,
				}).unwrap();
				toast.success(t("virtualKeys.updatedSuccess"));
			} else {
				// Create new virtual key
				const createData: CreateVirtualKeyRequest = {
					name: data.name,
					description: data.description || undefined,
					provider_configs: normalizedProviderConfigs,
					mcp_configs: data.mcpConfigs,
					team_id: data.entityType === "team" && data.teamId && data.teamId.trim() !== "" ? data.teamId : undefined,
					customer_id: data.entityType === "customer" && data.customerId && data.customerId.trim() !== "" ? data.customerId : undefined,
					is_active: data.isActive,
					// VK-level setting that governs both budget and rate-limit calendar alignment.
					calendar_aligned: data.budgetCalendarAligned,
				};

				// Add budgets if enabled
				const validBudgets = (data.budgets || []).filter(
					(b): b is { id?: string; max_limit: number; reset_duration: string } => b.max_limit !== undefined,
				);
				if (validBudgets.length > 0) {
					createData.budgets = validBudgets;
				}

				// Add rate limit if enabled
				const hasTokenMaxLimit = data.tokenMaxLimit !== undefined;
				const hasRequestMaxLimit = data.requestMaxLimit !== undefined;
				if (hasTokenMaxLimit || hasRequestMaxLimit) {
					createData.rate_limit = {
						token_max_limit: data.tokenMaxLimit,
						token_reset_duration: hasTokenMaxLimit ? data.tokenResetDuration || "1h" : undefined,
						request_max_limit: data.requestMaxLimit,
						request_reset_duration: hasRequestMaxLimit ? data.requestResetDuration || "1h" : undefined,
					};
				}

				await createVirtualKey(createData).unwrap();
				toast.success(t("virtualKeys.createdSuccess"));
			}

			onSave();
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	// Handle form submission
	const onSubmit = async (data: FormData) => {
		if (hasBudgetResetRelevantChanges(data)) {
			setPendingBudgetResetData(data);
			setPendingBudgetUsageWarning(getBudgetUsageWarning(data));
			setShowBudgetResetPrompt(true);
			return;
		}

		await submitVirtualKeyForm(data, false);
	};

	const handleBudgetResetChoice = async (resetBudgetUsage: boolean) => {
		if (!pendingBudgetResetData) return;
		const data = pendingBudgetResetData;
		setPendingBudgetResetData(null);
		setPendingBudgetUsageWarning(null);
		setShowBudgetResetPrompt(false);
		await submitVirtualKeyForm(data, resetBudgetUsage);
	};

	return (
		<Sheet open={isOpen} onOpenChange={(open) => !open && handleClose()}>
			<SheetContent
				className="flex w-full flex-col gap-4 overflow-x-hidden p-0 pt-4"
				data-testid="vk-sheet-content"
				onInteractOutside={(e) => e.preventDefault()}
				onEscapeKeyDown={() => handleClose()}
			>
				<SheetHeader className="flex flex-col items-start px-8 py-4" headerClassName="mb-0 sticky -top-4 bg-card z-10">
					<SheetTitle className="flex items-center gap-2">{isEditing ? virtualKey?.name : t("virtualKeys.createTitle")}</SheetTitle>
					<SheetDescription>{isEditing ? t("virtualKeys.editDescription") : t("virtualKeys.createDescription")}</SheetDescription>
				</SheetHeader>

				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="flex h-full flex-col gap-6">
						<div className="grow space-y-4 px-8">
							{isManagedByProfile && (
								<Alert variant="info">
									<Lock className="h-4 w-4" />
									<AlertDescription>{t("virtualKeys.sheet.managedAlert")}</AlertDescription>
								</Alert>
							)}

							{isTeamLocked && !isManagedByProfile && (
								<Alert variant="info">
									<Users className="h-4 w-4" />
									<AlertDescription>
										{t("virtualKeys.sheet.teamLockedAlert", { team: attachedTeam?.name ?? attachedTeamId })}
									</AlertDescription>
								</Alert>
							)}

							{/* Assigned User */}
							{assignedUsers.length > 0 && (
								<div className="space-y-1">
									<Label className="text-sm font-medium">{t("virtualKeys.assignedTo")}</Label>
									<div className="flex items-center gap-2">
										<Users className="text-muted-foreground h-4 w-4" />
										<span className="text-sm">{assignedUsers.map((u) => u.name || u.email).join(", ")}</span>
									</div>
								</div>
							)}

							{/* Basic Information */}
							<div className="space-y-4">
								<FormField
									control={form.control}
									name="name"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("virtualKeys.sheet.nameLabel")}</FormLabel>
											<FormControl>
												<Input placeholder={t("virtualKeys.sheet.namePlaceholder")} data-testid="vk-name-input" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="description"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("virtualKeys.sheet.descriptionLabel")}</FormLabel>
											<FormControl>
												<Textarea
													placeholder={t("virtualKeys.sheet.descriptionPlaceholder")}
													data-testid="vk-description-input"
													{...field}
													rows={3}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
							<fieldset
								disabled={isManagedByProfile}
								aria-disabled={isManagedByProfile}
								inert={isManagedByProfile ? true : undefined}
								className={isManagedByProfile ? "pointer-events-none space-y-4 opacity-50" : "space-y-4"}
							>
								<div className="space-y-4">
									<FormField
										control={form.control}
										name="isActive"
										render={({ field }) => (
											<FormItem>
												<Toggle
													label={t("virtualKeys.sheet.isActiveLabel")}
													val={field.value}
													setVal={field.onChange}
													data-testid="vk-is-active-toggle"
												/>
											</FormItem>
										)}
									/>
								</div>
								{/* Provider Configurations */}
								<div className="space-y-2">
									<div className="flex items-center gap-2">
										<Label className="text-sm font-medium">{t("virtualKeys.sheet.providerConfigs")}</Label>
										<TooltipProvider>
											<Tooltip>
												<TooltipTrigger asChild>
													<span>
														<Info className="text-muted-foreground h-3 w-3" />
													</span>
												</TooltipTrigger>
												<TooltipContent>
													<p>{t("virtualKeys.sheet.providerTooltip")}</p>
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>
									</div>

									{/* Add Provider Dropdown */}
									<div className="flex gap-2">
										<Select
											value={selectedProvider}
											onValueChange={(provider) => {
												if (provider === "__manage_providers__") {
													navigate({ to: "/workspace/providers" });
													setSelectedProvider("");
													return;
												}
												handleAddProvider(provider);
												setSelectedProvider(""); // Reset to placeholder state
											}}
										>
											<SelectTrigger className="flex-1" data-testid="vk-provider-select">
												<SelectValue placeholder={t("virtualKeys.sheet.selectProvider")} />
											</SelectTrigger>
											<SelectContent>
												{(() => {
													// Filter out already configured providers
													const unconfiguredProviders = availableProviders.filter(
														(provider) => !providerConfigs.some((config) => config.provider === provider.name),
													);

													if (unconfiguredProviders.length === 0) {
														return (
															<SelectItem
																value="__manage_providers__"
																className="text-muted-foreground hover:text-foreground"
																data-testid="vk-provider-config-link"
															>
																<span>
																	{t("virtualKeys.sheet.noProvidersLeft")}{" "}
																	<span className="text-primary font-medium underline">{t("virtualKeys.sheet.clickToAdd")}</span>
																</span>
															</SelectItem>
														);
													}

													// Separate base providers and custom providers
													const baseProviders = unconfiguredProviders.filter((provider) => !provider.custom_provider_config);
													const customProviders = unconfiguredProviders.filter((provider) => provider.custom_provider_config);

													return (
														<>
															{/* Base providers first */}
															{baseProviders
																.filter((p) => p.name)
																.map((provider, index) => (
																	<SelectItem key={`base-${index}`} value={provider.name}>
																		<RenderProviderIcon provider={provider.name as KnownProvider} size="sm" className="h-4 w-4" />
																		{ProviderLabels[provider.name as ProviderName]}
																	</SelectItem>
																))}

															{/* Custom providers second */}
															{customProviders
																.filter((p) => p.name)
																.map((provider, index) => (
																	<SelectItem key={`custom-${index}`} value={provider.name}>
																		<RenderProviderIcon
																			provider={provider.custom_provider_config?.base_provider_type || (provider.name as KnownProvider)}
																			size="sm"
																			className="h-4 w-4"
																		/>
																		{provider.name}
																	</SelectItem>
																))}
														</>
													);
												})()}
											</SelectContent>
										</Select>
									</div>

									{/* Provider Configurations Table */}
									{providerConfigs.length > 0 && (
										<div className="rounded-md border px-2">
											<Accordion type="multiple" className="w-full">
												{providerConfigs.map((config, index) => {
													const providerConfig = availableProviders.find((provider) => provider.name === config.provider);
													return (
														<AccordionItem key={index} className="w-full" value={`${config.provider}-${index}`}>
															<AccordionTrigger className="flex h-12 items-center gap-0 px-1">
																<div className="flex w-full items-center justify-between">
																	<div className="flex w-fit items-center gap-2">
																		<RenderProviderIcon
																			provider={
																				providerConfig?.custom_provider_config?.base_provider_type || (config.provider as ProviderIconType)
																			}
																			size="sm"
																			className="h-4 w-4"
																		/>
																		{providerConfig?.custom_provider_config
																			? providerConfig.name
																			: ProviderLabels[config.provider as ProviderName]}
																	</div>
																	<Button
																		type="button"
																		variant="ghost"
																		size="icon"
																		aria-label={t("virtualKeys.sheet.removeProviderAria", { provider: config.provider })}
																		className="hover:bg-accent/50 h-8 w-8 rounded-sm p-2"
																		data-testid={`vk-delete-provider-${index}`}
																		onClick={(e) => {
																			e.stopPropagation();
																			handleRemoveProvider(index);
																		}}
																	>
																		<Trash2 className="h-4 w-4 opacity-75" />
																	</Button>
																</div>
															</AccordionTrigger>
															<AccordionContent className="flex flex-col gap-4 px-1 text-balance">
																<div className="flex w-full items-start gap-2">
																	<div className="w-1/4">
																		<NumberAndSelect
																			id={`vk-weight-${index}`}
																			label={t("virtualKeys.sheet.weight")}
																			labelClassName="text-sm font-medium"
																			placeholder={t("virtualKeys.sheet.excludeFromRouting")}
																			inputClassName="h-[38px] w-full"
																			dataTestId={`vk-weight-input-${index}`}
																			value={config.weight}
																			onChangeNumber={(value) => handleUpdateProviderConfig(index, "weight", value)}
																		/>
																	</div>
																	<div className="w-3/4 space-y-2">
																		<Label className="text-sm font-medium">
																			{t("virtualKeys.sheet.allowedModels")}{" "}
																			<span className="text-muted-foreground ml-auto text-xs italic">
																				{t("virtualKeys.sheet.typeToSearch")}
																			</span>
																		</Label>
																		{(() => {
																			const hasWildcardModels = (config.allowed_models || []).includes("*");
																			return (
																				<ModelMultiselect
																					data-testid={`vk-models-multiselect-${index}`}
																					provider={config.provider}
																					keys={(() => {
																						const providerKeys = availableKeys.filter((key) => key.provider === config.provider);
																						const configKeyIds = config.key_ids || [];
																						return configKeyIds.includes("*")
																							? providerKeys.map((key) => key.key_id)
																							: providerKeys.filter((key) => configKeyIds.includes(key.key_id)).map((key) => key.key_id);
																					})()}
																					allowAllOption={true}
																					value={hasWildcardModels ? ["*"] : config.allowed_models || []}
																					onChange={(models: string[]) => {
																						const hadStar = (config.allowed_models || []).includes("*");
																						const hasStar = models.includes("*");
																						if (!hadStar && hasStar) {
																							handleUpdateProviderConfig(index, "allowed_models", ["*"]);
																						} else if (hadStar && hasStar && models.length > 1) {
																							handleUpdateProviderConfig(
																								index,
																								"allowed_models",
																								models.filter((m) => m !== "*"),
																							);
																						} else {
																							handleUpdateProviderConfig(index, "allowed_models", models);
																						}
																					}}
																					placeholder={
																						hasWildcardModels
																							? t("virtualKeys.sheet.allModelsAllowed")
																							: (config.allowed_models || []).length === 0
																								? t("virtualKeys.sheet.noModelsDenyAll")
																								: config.provider
																									? ModelPlaceholders[config.provider as keyof typeof ModelPlaceholders] ||
																										ModelPlaceholders.default
																									: ModelPlaceholders.default
																					}
																					className="min-h-10 max-w-[500px] min-w-[200px]"
																				/>
																			);
																		})()}
																		<p className="text-muted-foreground text-xs">{t("virtualKeys.sheet.allowedModelsHint")}</p>
																	</div>
																</div>

																{/* Blocked Models for this provider */}
																<div className="flex w-full items-start gap-2">
																	<div className="w-1/4" />
																	<div className="w-3/4 space-y-2">
																		<div className="flex items-center gap-2">
																			<Label className="text-sm font-medium">{t("virtualKeys.sheet.blockedModels")}</Label>
																			<TooltipProvider>
																				<Tooltip>
																					<TooltipTrigger asChild>
																						<span>
																							<Info className="text-muted-foreground h-3 w-3" />
																						</span>
																					</TooltipTrigger>
																					<TooltipContent>
																						<p>{t("virtualKeys.sheet.blockedModelsTooltip")}</p>
																					</TooltipContent>
																				</Tooltip>
																			</TooltipProvider>
																		</div>
																		{(() => {
																			const hasWildcardBlocked = (config.blacklisted_models || []).includes("*");
																			return (
																				<ModelMultiselect
																					data-testid={`vk-models-blocked-multiselect-${index}`}
																					provider={config.provider}
																					keys={(() => {
																						const providerKeys = availableKeys.filter((key) => key.provider === config.provider);
																						const configKeyIds = config.key_ids || [];
																						return configKeyIds.includes("*")
																							? providerKeys.map((key) => key.key_id)
																							: providerKeys.filter((key) => configKeyIds.includes(key.key_id)).map((key) => key.key_id);
																					})()}
																					allowAllOption={true}
																					value={hasWildcardBlocked ? ["*"] : config.blacklisted_models || []}
																					onChange={(models: string[]) => {
																						const hadStar = (config.blacklisted_models || []).includes("*");
																						const hasStar = models.includes("*");
																						if (!hadStar && hasStar) {
																							handleUpdateProviderConfig(index, "blacklisted_models", ["*"]);
																						} else if (hadStar && hasStar && models.length > 1) {
																							handleUpdateProviderConfig(
																								index,
																								"blacklisted_models",
																								models.filter((m) => m !== "*"),
																							);
																						} else {
																							handleUpdateProviderConfig(index, "blacklisted_models", models);
																						}
																					}}
																					placeholder={
																						hasWildcardBlocked
																							? t("virtualKeys.sheet.allModelsBlocked")
																							: (config.blacklisted_models || []).length === 0
																								? t("virtualKeys.sheet.noModelsBlocked")
																								: t("virtualKeys.sheet.searchModels")
																					}
																					className="min-h-10 max-w-[500px] min-w-[200px]"
																				/>
																			);
																		})()}
																	</div>
																</div>

																{/* Allowed Keys for this provider */}
																{(() => {
																	const providerKeys = availableKeys.filter((key) => key.provider === config.provider);
																	const configKeyIds = config.key_ids || [];
																	const hasWildcard = configKeyIds.includes("*");
																	const allKeyOptions = [
																		{
																			label: t("virtualKeys.sheet.allowAllKeys"),
																			value: "*",
																			description: t("virtualKeys.sheet.allowAllKeysDesc"),
																			provider: "",
																		},
																		...providerKeys.map((key) => ({
																			label: key.name,
																			value: key.key_id,
																			description:
																				key.models == null || key.models.includes("*")
																					? t("virtualKeys.sheet.allModels")
																					: key.models.filter((m) => m !== "*").join(", ") || t("virtualKeys.sheet.noModelsDenyAll"),
																			provider: key.provider,
																		})),
																	];
																	const selectedProviderKeys = hasWildcard
																		? [allKeyOptions[0]]
																		: providerKeys
																				.filter((key) => configKeyIds.includes(key.key_id))
																				.map((key) => ({
																					label: key.name,
																					value: key.key_id,
																					description:
																						key.models == null || key.models.includes("*")
																							? t("virtualKeys.sheet.allModels")
																							: key.models.filter((m) => m !== "*").join(", ") || t("virtualKeys.sheet.noModelsDenyAll"),
																					provider: key.provider,
																				}));

																	return (
																		<div className="mx-0.5 space-y-2">
																			<Label className="text-sm font-medium">{t("virtualKeys.allowedKeys")}</Label>
																			<p className="text-muted-foreground text-xs">{t("virtualKeys.sheet.allowedKeysHint")}</p>
																			<AsyncMultiSelect
																				hideSelectedOptions
																				isNonAsync
																				closeMenuOnSelect={false}
																				menuPlacement="auto"
																				defaultOptions={allKeyOptions}
																				views={{
																					multiValue: (multiValueProps: MultiValueProps<VirtualKeyType>) => {
																						return (
																							<div
																								{...multiValueProps.innerProps}
																								className="bg-accent dark:!bg-card flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-sm"
																							>
																								{multiValueProps.data.label}{" "}
																								<X
																									className="hover:text-foreground text-muted-foreground h-4 w-4 cursor-pointer"
																									onClick={(e) => {
																										e.stopPropagation();
																										multiValueProps.removeProps.onClick?.(e as any);
																									}}
																								/>
																							</div>
																						);
																					},
																					option: (optionProps: OptionProps<VirtualKeyType>) => {
																						const { Option } = components;
																						return (
																							<Option
																								{...optionProps}
																								className={cn(
																									"flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm",
																									optionProps.isFocused && "bg-accent dark:!bg-card",
																									"hover:bg-accent",
																									optionProps.isSelected && "bg-accent dark:!bg-card",
																								)}
																							>
																								<span className="text-content-primary grow truncate text-sm">{optionProps.data.label}</span>
																								{optionProps.data.description && (
																									<span className="text-content-tertiary max-w-[70%] text-sm">
																										{optionProps.data.description}
																									</span>
																								)}
																							</Option>
																						);
																					},
																				}}
																				value={selectedProviderKeys}
																				onChange={(keys) => {
																					const hadStar = hasWildcard;
																					const hasStar = keys.some((k) => k.value === "*");
																					if (!hadStar && hasStar) {
																						// Just selected "Allow All Keys" — set to ["*"] only
																						handleUpdateProviderConfig(index, "key_ids", ["*"]);
																					} else if (hadStar && hasStar && keys.length > 1) {
																						// Had "*", still has "*", but user also selected a specific key — drop "*"
																						handleUpdateProviderConfig(
																							index,
																							"key_ids",
																							keys.filter((k) => k.value !== "*").map((k) => k.value as string),
																						);
																					} else {
																						handleUpdateProviderConfig(
																							index,
																							"key_ids",
																							keys.map((k) => k.value as string),
																						);
																					}
																				}}
																				placeholder={
																					hasWildcard
																						? t("virtualKeys.sheet.allKeysAllowed")
																						: configKeyIds.length === 0
																							? t("virtualKeys.sheet.noKeysSelected")
																							: t("virtualKeys.sheet.selectKeys")
																				}
																				className="hover:bg-accent w-full"
																				menuClassName="z-[60] max-h-[300px] overflow-y-auto w-full cursor-pointer custom-scrollbar"
																			/>
																		</div>
																	);
																})()}

																<DottedSeparator />

																{/* Provider Budget Configuration */}
																<MultiBudgetLines
																	data-testid={`vk-provider-budget-${index}`}
																	label={t("virtualKeys.sheet.providerBudget")}
																	lines={
																		config.budgets && config.budgets.length > 0
																			? config.budgets.map((b) => ({
																					id: b.id,
																					max_limit: b.max_limit,
																					reset_duration: b.reset_duration || "1M",
																				}))
																			: []
																	}
																	onChange={(lines) => {
																		const updatedConfigs = [...providerConfigs];
																		updatedConfigs[index] = {
																			...updatedConfigs[index],
																			budgets: lines.map((l) => ({
																				id: l.id,
																				max_limit: l.max_limit,
																				reset_duration: l.reset_duration,
																			})),
																		};
																		form.setValue("providerConfigs", updatedConfigs, { shouldDirty: true });
																	}}
																/>

																<DottedSeparator />

																{/* Provider Rate Limit Configuration */}
																<div className="space-y-4">
																	<Label className="text-sm font-medium">{t("virtualKeys.sheet.providerRateLimits")}</Label>

																	<NumberAndSelect
																		id={`providerTokenLimit-${index}`}
																		labelClassName="font-normal"
																		label={t("virtualKeys.sheet.maxTokens")}
																		value={config.rate_limit?.token_max_limit}
																		selectValue={config.rate_limit?.token_reset_duration || "1h"}
																		onChangeNumber={(value) => {
																			const currentRateLimit = config.rate_limit || {};
																			handleUpdateProviderConfig(index, "rate_limit", {
																				...currentRateLimit,
																				token_max_limit: value,
																			});
																		}}
																		onChangeSelect={(value) => {
																			const currentRateLimit = config.rate_limit || {};
																			handleUpdateProviderConfig(index, "rate_limit", {
																				...currentRateLimit,
																				token_reset_duration: value,
																			});
																		}}
																		options={resetDurationOptions}
																	/>

																	<NumberAndSelect
																		id={`providerRequestLimit-${index}`}
																		labelClassName="font-normal"
																		label={t("virtualKeys.sheet.maxRequests")}
																		value={config.rate_limit?.request_max_limit}
																		selectValue={config.rate_limit?.request_reset_duration || "1h"}
																		onChangeNumber={(value) => {
																			const currentRateLimit = config.rate_limit || {};
																			handleUpdateProviderConfig(index, "rate_limit", {
																				...currentRateLimit,
																				request_max_limit: value,
																			});
																		}}
																		onChangeSelect={(value) => {
																			const currentRateLimit = config.rate_limit || {};
																			handleUpdateProviderConfig(index, "rate_limit", {
																				...currentRateLimit,
																				request_reset_duration: value,
																			});
																		}}
																		options={resetDurationOptions}
																	/>
																</div>
															</AccordionContent>
														</AccordionItem>
													);
												})}
											</Accordion>
										</div>
									)}
									{/* Display validation errors for provider configurations */}
									{form.formState.errors.providerConfigs && (
										<div className="text-destructive text-sm">{form.formState.errors.providerConfigs.message}</div>
									)}
								</div>
								{/* MCP Client Configurations */}
								{((mcpClientsData && mcpClientsData.length > 0) || (mcpConfigs && mcpConfigs.length > 0)) && (
									<div className="mt-6 space-y-2">
										<div className="flex items-center gap-2">
											<Label className="text-sm font-medium">{t("virtualKeys.sheet.mcpConfigs")}</Label>
											<TooltipProvider>
												<Tooltip>
													<TooltipTrigger asChild>
														<span>
															<Info className="text-muted-foreground h-3 w-3" />
														</span>
													</TooltipTrigger>
													<TooltipContent>
														<p>
															{t("virtualKeys.sheet.mcpTooltip")}{" "}
															<span className="font-medium">{t("virtualKeys.sheet.mcpTooltipAllowAll")}</span>{" "}
															{t("virtualKeys.sheet.mcpTooltipSuffix")}
														</p>
													</TooltipContent>
												</Tooltip>
											</TooltipProvider>
										</div>

										{/* MCP servers available on all virtual keys by default, excluding explicitly overridden ones */}
										{(() => {
											const defaultMCPClients = mcpClientsData.filter(
												(client) =>
													client.config.allow_on_all_virtual_keys &&
													!mcpConfigs.some((config) => config.mcp_client_name === client.config.name),
											);
											return defaultMCPClients.length > 0 ? (
												<div className="text-muted-foreground rounded-md border p-3 text-xs">
													<div className="flex items-start gap-1.5">
														<Info className="mt-0.5 h-3 w-3 shrink-0" />
														<span>
															{t("virtualKeys.sheet.defaultMcpServersHint", {
																names: defaultMCPClients.map((c) => c.config.name).join(", "),
															})}
														</span>
													</div>
												</div>
											) : null;
										})()}

										{/* Add MCP Client Dropdown */}
										{mcpClientsData && mcpClientsData.length > 0 && (
											<div className="flex gap-2">
												<Select
													value={selectedMCPClient}
													onValueChange={(mcpClientId) => {
														handleAddMCPClient(mcpClientId);
														setSelectedMCPClient(""); // Reset to placeholder state
													}}
												>
													<SelectTrigger className="flex-1">
														<SelectValue placeholder={t("virtualKeys.sheet.selectMcpClient")} />
													</SelectTrigger>
													<SelectContent>
														{mcpClientsData.filter((client) => !mcpConfigs.some((config) => config.mcp_client_name === client.config.name))
															.length > 0 ? (
															mcpClientsData
																.filter(
																	(client) =>
																		client.config.name && !mcpConfigs.some((config) => config.mcp_client_name === client.config.name),
																)
																.map((client, index) => {
																	const client_tools = client.tools || [];
																	const totalTools = client.config.tools_to_execute?.includes("*")
																		? client_tools.length
																		: client_tools.filter((tool) => client.config.tools_to_execute?.includes(tool.name)).length;
																	return (
																		<SelectItem key={index} value={client.config.name}>
																			<div className="flex items-center gap-2">
																				{client.config.name}
																				<span className="text-muted-foreground text-xs">
																					({totalTools}{" "}
																					{totalTools === 1 ? t("virtualKeys.sheet.enabledTool") : t("virtualKeys.sheet.enabledTools")})
																				</span>
																			</div>
																		</SelectItem>
																	);
																})
														) : (
															<div className="text-muted-foreground px-2 py-1.5 text-sm">{t("virtualKeys.sheet.allMcpConfigured")}</div>
														)}
													</SelectContent>
												</Select>
											</div>
										)}

										{/* MCP Configurations Table */}
										{mcpConfigs.length > 0 && (
											<div className="rounded-md border">
												<Table>
													<TableHeader>
														<TableRow>
															<TableHead>{t("virtualKeys.sheet.mcpClient")}</TableHead>
															<TableHead>{t("virtualKeys.sheet.allowedTools")}</TableHead>
															<TableHead className="w-[50px]"></TableHead>
														</TableRow>
													</TableHeader>
													<TableBody>
														{mcpConfigs.map((config, index) => {
															const mcpClient = mcpClientsData?.find((client) => client.config.name === config.mcp_client_name);

															// Handle new wildcard semantics for client-level filtering
															const clientToolsToExecute = mcpClient?.config?.tools_to_execute;
															let availableTools: any[] = [];

															if (!clientToolsToExecute || clientToolsToExecute.length === 0) {
																// nil/undefined or empty array - no tools available from client config
																availableTools = [];
															} else if (clientToolsToExecute.includes("*")) {
																// Wildcard - all tools available
																availableTools = mcpClient?.tools || [];
															} else {
																// Specific tools listed
																availableTools = (mcpClient?.tools || []).filter((tool) => clientToolsToExecute.includes(tool.name)) || [];
															}

															const enabledToolsByConfig =
																(mcpClient?.tools || []).filter((tool) => config.tools_to_execute?.includes(tool.name)) || [];
															const selectedTools = config.tools_to_execute || [];

															return (
																<TableRow key={`${config.mcp_client_name}-${index}`}>
																	<TableCell className="w-[150px]">{config.mcp_client_name}</TableCell>
																	<TableCell>
																		<MultiSelect
																			options={[
																				{
																					label: t("virtualKeys.sheet.allowAllTools"),
																					value: "*",
																					description: t("virtualKeys.sheet.allowAllToolsDesc"),
																				},
																				...[...availableTools, ...enabledToolsByConfig]
																					.filter((tool, index, arr) => arr.findIndex((t) => t.name === tool.name) === index)
																					.map((tool) => ({
																						label: tool.name,
																						value: tool.name,
																						description: tool.description,
																					})),
																			]}
																			defaultValue={selectedTools}
																			onValueChange={(tools: string[]) => {
																				const hadStar = selectedTools.includes("*");
																				const hasStar = tools.includes("*");
																				if (!hadStar && hasStar) {
																					// Just selected "Allow All Tools" — set to ["*"] only
																					handleUpdateMCPConfig(index, "tools_to_execute", ["*"]);
																				} else if (hadStar && hasStar && tools.length > 1) {
																					// Had "*", still has "*", but user also selected a specific tool — drop "*"
																					handleUpdateMCPConfig(
																						index,
																						"tools_to_execute",
																						tools.filter((t) => t !== "*"),
																					);
																				} else {
																					handleUpdateMCPConfig(index, "tools_to_execute", tools);
																				}
																			}}
																			placeholder={
																				selectedTools.length === 0
																					? t("virtualKeys.sheet.noToolsSelected")
																					: selectedTools.includes("*")
																						? t("virtualKeys.sheet.allToolsAllowed")
																						: t("virtualKeys.sheet.selectTools")
																			}
																			variant="inverted"
																			className="hover:bg-accent w-full bg-white dark:bg-zinc-800"
																			commandClassName="w-full max-w-96"
																			modalPopover={true}
																			animation={0}
																		/>
																	</TableCell>
																	<TableCell>
																		<Button
																			type="button"
																			variant="ghost"
																			size="sm"
																			onClick={() => handleRemoveMCPClient(index)}
																			data-testid={`vk-delete-mcp-${index}`}
																		>
																			<Trash2 className="h-4 w-4" />
																		</Button>
																	</TableCell>
																</TableRow>
															);
														})}
													</TableBody>
												</Table>
											</div>
										)}
									</div>
								)}
								<DottedSeparator className="mt-6 mb-5" />
								{/* Budget Configuration */}
								<div className="space-y-4">
									<MultiBudgetLines
										data-testid="vk-budget-lines"
										label={t("virtualKeys.sheet.budgetConfig")}
										lines={form.watch("budgets") ?? []}
										onChange={(lines) => {
											form.setValue("budgets", lines, { shouldDirty: true });
										}}
										onReset={clearVirtualKeyBudget}
										showReset={isEditing && !!(virtualKey?.budgets?.length || (watchedBudgets && watchedBudgets.length > 0))}
									/>

									{/* Reassign team confirmation dialog */}
									<AlertDialog
										open={showReassignTeamWarning}
										onOpenChange={(open) => {
											setShowReassignTeamWarning(open);
											if (!open) {
												setPendingTeamId(null);
											}
										}}
									>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>{t("virtualKeys.sheet.reassignTitle")}</AlertDialogTitle>
												<AlertDialogDescription>{t("virtualKeys.sheet.reassignDesc")}</AlertDialogDescription>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel data-testid="virtual-key-reassign-cancel" onClick={() => setPendingTeamId(null)}>
													{t("common.actions.cancel")}
												</AlertDialogCancel>
												<AlertDialogAction
													data-testid="virtual-key-reassign-confirm"
													onClick={() => {
														if (pendingTeamId !== null) {
															form.setValue("teamId", pendingTeamId, {
																shouldDirty: true,
															});
														}
														setPendingTeamId(null);
														setShowReassignTeamWarning(false);
													}}
												>
													{t("virtualKeys.sheet.reassign")}
												</AlertDialogAction>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								</div>
								{/* Rate Limiting Configuration */}
								<div className="space-y-4">
									<div className="flex items-center justify-between gap-2">
										<Label className="text-sm font-medium">{t("virtualKeys.sheet.rateLimitConfig")}</Label>
										{isEditing && (virtualKey?.rate_limit || watchedTokenMaxLimit || watchedRequestMaxLimit) && (
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={clearVirtualKeyRateLimits}
												data-testid="vk-rate-limit-reset-button"
											>
												<RotateCcw className="h-4 w-4" />
												{t("virtualKeys.sheet.reset")}
											</Button>
										)}
									</div>

									<FormField
										control={form.control}
										name="tokenMaxLimit"
										render={({ field }) => (
											<FormItem>
												<NumberAndSelect
													id="tokenMaxLimit"
													labelClassName="font-normal"
													label={t("virtualKeys.sheet.maxTokens")}
													value={field.value}
													selectValue={form.watch("tokenResetDuration") || "1h"}
													onChangeNumber={(value) => {
														field.onChange(value);
													}}
													onChangeSelect={(value) =>
														form.setValue("tokenResetDuration", value, {
															shouldDirty: true,
														})
													}
													options={resetDurationOptions}
												/>
												<FormMessage />
											</FormItem>
										)}
									/>

									<FormField
										control={form.control}
										name="requestMaxLimit"
										render={({ field }) => (
											<FormItem>
												<NumberAndSelect
													id="requestMaxLimit"
													labelClassName="font-normal"
													label={t("virtualKeys.sheet.maxRequests")}
													value={field.value}
													selectValue={form.watch("requestResetDuration") || "1h"}
													onChangeNumber={(value) => {
														field.onChange(value);
													}}
													onChangeSelect={(value) =>
														form.setValue("requestResetDuration", value, {
															shouldDirty: true,
														})
													}
													options={resetDurationOptions}
												/>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>
								{/* Calendar alignment — VK-wide setting that applies to both budgets and rate limits */}
								{showCalendarAlignToggle && (
									<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
										<div className="space-y-0.5">
											<Label htmlFor="vk-budget-calendar-aligned-toggle" className="text-sm font-normal">
												{t("virtualKeys.sheet.calendarAlignLabel")}
											</Label>
											<p id="vk-budget-calendar-aligned-description" className="text-muted-foreground text-xs">
												{t("virtualKeys.sheet.calendarAlignDesc")}
											</p>
										</div>
										<Switch
											id="vk-budget-calendar-aligned-toggle"
											aria-describedby="vk-budget-calendar-aligned-description"
											checked={watchedBudgetCalendarAligned}
											onCheckedChange={handleCalendarAlignedChange}
											data-testid="vk-budget-calendar-aligned-toggle"
										/>
									</div>
								)}

								{/* Warning dialog shown when enabling calendar alignment on an existing VK */}
								<AlertDialog open={showCalendarAlignWarning} onOpenChange={setShowCalendarAlignWarning}>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>{t("virtualKeys.sheet.calendarAlignTitle")}</AlertDialogTitle>
											<AlertDialogDescription>{t("virtualKeys.sheet.calendarAlignWarning")}</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel data-testid="vk-calendar-align-cancel-btn">{t("common.actions.cancel")}</AlertDialogCancel>
											<AlertDialogAction
												data-testid="vk-calendar-align-enable-btn"
												onClick={() => {
													form.setValue("budgetCalendarAligned", true, {
														shouldDirty: true,
													});
													setShowCalendarAlignWarning(false);
												}}
											>
												{t("virtualKeys.sheet.enableCalendarAlign")}
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
								{(teams?.length > 0 || customers?.length > 0) && (
									<>
										<DottedSeparator className="my-6" />

										{/* Entity Assignment */}
										<div className="space-y-4">
											<Label className="text-sm font-medium">{t("virtualKeys.sheet.entityAssignment")}</Label>

											<div className="grid grid-cols-1 items-center gap-2 md:grid-cols-2">
												<FormField
													control={form.control}
													name="entityType"
													render={({ field }) => (
														<FormItem>
															<FormLabel className="font-normal">{t("virtualKeys.sheet.assignmentType")}</FormLabel>
															<ComboboxSelect
																options={[
																	{ value: "none", label: t("virtualKeys.sheet.noAssignment") },
																	...(teams?.length > 0
																		? [
																				{
																					value: "team",
																					label: t("virtualKeys.sheet.assignToTeam"),
																				},
																			]
																		: []),
																	...(customers?.length > 0
																		? [
																				{
																					value: "customer",
																					label: t("virtualKeys.sheet.assignToCustomer"),
																				},
																			]
																		: []),
																]}
																value={field.value}
																onValueChange={async (value) => {
																	const val = value ?? "none";
																	field.onChange(val);
																	if (val === "team" && teams?.length > 0) {
																		form.setValue("teamId", teams[0].id, {
																			shouldDirty: true,
																			shouldValidate: true,
																		});
																		form.setValue("customerId", "", {
																			shouldDirty: true,
																			shouldValidate: true,
																		});
																		await form.trigger(["teamId", "customerId", "entityType"]);
																	} else if (val === "customer" && customers?.length > 0) {
																		form.setValue("customerId", customers[0].id, {
																			shouldDirty: true,
																			shouldValidate: true,
																		});
																		form.setValue("teamId", "", {
																			shouldDirty: true,
																			shouldValidate: true,
																		});
																		await form.trigger(["teamId", "customerId", "entityType"]);
																	} else {
																		form.setValue("teamId", "", {
																			shouldDirty: true,
																			shouldValidate: true,
																		});
																		form.setValue("customerId", "", {
																			shouldDirty: true,
																			shouldValidate: true,
																		});
																		await form.trigger(["teamId", "customerId", "entityType"]);
																	}
																}}
																disabled={isTeamLocked}
																disableSearch
																hideClear
																className="h-9"
															/>
															<FormMessage />
														</FormItem>
													)}
												/>
												{form.watch("entityType") === "team" && teams?.length > 0 && (
													<FormField
														control={form.control}
														name="teamId"
														render={({ field }) => (
															<FormItem>
																<FormLabel className="font-normal">{t("virtualKeys.sheet.selectTeam")}</FormLabel>
																<ComboboxSelect
																	options={teams.map((team) => ({
																		value: team.id,
																		label: team.customer ? `${team.name} — ${team.customer.name}` : team.name,
																	}))}
																	value={field.value || null}
																	onValueChange={(val) => {
																		const newVal = val ?? "";
																		if (isEditing && virtualKey?.team_id && newVal && newVal !== virtualKey.team_id) {
																			setPendingTeamId(newVal);
																			setShowReassignTeamWarning(true);
																		} else {
																			field.onChange(newVal);
																		}
																	}}
																	placeholder={t("virtualKeys.sheet.selectTeamPlaceholder")}
																	disabled={isTeamLocked}
																	emptyMessage={t("virtualKeys.sheet.noTeamsFound")}
																	className="h-9"
																/>
																<FormMessage />
															</FormItem>
														)}
													/>
												)}

												{form.watch("entityType") === "customer" && customers?.length > 0 && (
													<FormField
														control={form.control}
														name="customerId"
														render={({ field }) => (
															<FormItem>
																<FormLabel className="font-normal">{t("virtualKeys.sheet.selectCustomer")}</FormLabel>
																<ComboboxSelect
																	options={customers.map((customer) => ({
																		value: customer.id,
																		label: customer.name,
																	}))}
																	value={field.value || null}
																	onValueChange={(val) => field.onChange(val ?? "")}
																	placeholder={t("virtualKeys.sheet.selectCustomerPlaceholder")}
																	emptyMessage={t("virtualKeys.sheet.noCustomersFound")}
																	className="h-9"
																/>
																<FormMessage />
															</FormItem>
														)}
													/>
												)}
											</div>
										</div>
									</>
								)}
							</fieldset>
						</div>
						<AlertDialog open={showRotateWarning} onOpenChange={setShowRotateWarning}>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>{t("virtualKeys.sheet.rotateTitle")}</AlertDialogTitle>
									<AlertDialogDescription>{t("virtualKeys.sheet.rotateDesc", { name: virtualKey?.name ?? "" })}</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel data-testid="vk-rotate-cancel-btn">{t("common.actions.cancel")}</AlertDialogCancel>
									<AlertDialogAction onClick={handleRotateVirtualKey} disabled={isRotating} data-testid="vk-rotate-confirm-btn">
										{isRotating ? t("virtualKeys.rotating") : t("virtualKeys.sheet.rotateKey")}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
						<AlertDialog open={showBudgetResetPrompt} onOpenChange={setShowBudgetResetPrompt}>
							<AlertDialogContent data-testid="vk-budget-reset-dialog">
								<AlertDialogHeader>
									<AlertDialogTitle>
										{pendingBudgetUsageWarning ? t("virtualKeys.sheet.budgetPreserveTitle") : t("virtualKeys.sheet.budgetResetTitle")}
									</AlertDialogTitle>
									<AlertDialogDescription>
										{pendingBudgetUsageWarning
											? `${pendingBudgetUsageWarning}${t("virtualKeys.sheet.budgetPreserveSuffix")}`
											: t("virtualKeys.sheet.budgetResetDesc")}
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel onClick={() => handleBudgetResetChoice(false)} data-testid="vk-budget-reset-preserve-btn">
										{pendingBudgetUsageWarning ? t("virtualKeys.sheet.preserveAnyway") : t("virtualKeys.sheet.preserveUsage")}
									</AlertDialogCancel>
									<AlertDialogAction onClick={() => handleBudgetResetChoice(true)} data-testid="vk-budget-reset-confirm-btn">
										{t("virtualKeys.sheet.resetUsage")}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
						{isEditing && virtualKey?.config_hash && (
							<div className="px-8">
								<ConfigSyncAlert className="mt-2" />
							</div>
						)}
						{/* Form Footer */}
						<div className="border-border bg-card sticky bottom-0 z-10 border-t px-8 py-4">
							<div className="flex items-center justify-between gap-2">
								{isEditing ? (
									<Button
										type="button"
										variant="outline"
										onClick={() => setShowRotateWarning(true)}
										disabled={!hasUpdateAccess || isRotating}
										data-testid="vk-rotate-btn"
									>
										<RotateCcw className="h-4 w-4" />
										{isRotating ? t("virtualKeys.rotating") : t("virtualKeys.sheet.rotateKey")}
									</Button>
								) : (
									<span />
								)}
								<div className="flex justify-end gap-2">
									<Button type="button" variant="outline" onClick={handleClose} data-testid="vk-cancel-btn">
										{t("common.actions.cancel")}
									</Button>
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<span className="inline-block">
													<Button type="submit" disabled={isLoading || !form.formState.isDirty || !canSubmit} data-testid="vk-save-btn">
														{isLoading
															? t("common.actions.saving")
															: isEditing
																? t("virtualKeys.sheet.update")
																: t("virtualKeys.sheet.create")}
													</Button>
												</span>
											</TooltipTrigger>
											{(isLoading || !form.formState.isDirty || !canSubmit) && (
												<TooltipContent>
													<p>
														{!canSubmit
															? t("virtualKeys.noPermission")
															: isLoading
																? t("common.actions.saving")
																: !form.formState.isDirty
																	? t("virtualKeys.sheet.noChanges")
																	: ""}
													</p>
												</TooltipContent>
											)}
										</Tooltip>
									</TooltipProvider>
								</div>
							</div>
						</div>
					</form>
				</Form>
			</SheetContent>
		</Sheet>
	);
}