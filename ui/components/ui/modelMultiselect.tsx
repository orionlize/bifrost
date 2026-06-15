import { useT } from "@/lib/i18n";
import { cn } from "@/components/ui/utils";
import { filterModelsForProviderListing } from "@/lib/utils/providerModelListing";
import { KnownProvidersNames } from "@/lib/constants/logs";
import {
	useGetModelsQuery,
	useLazyGetBaseModelsQuery,
	useLazyGetModelsQuery,
	type GetModelsRequest,
	type ModelResponse,
} from "@/lib/store/apis/providersApi";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { components, MultiValueProps, OptionProps, SingleValueProps } from "react-select";
import { AsyncMultiSelect } from "./asyncMultiselect";
import { Option } from "./multiselectUtils";

interface ModelMultiselectPropsBase {
	provider?: string;
	keys?: string[];
	vks?: string[];
	placeholder?: string;
	disabled?: boolean;
	className?: string;
	/** Load models even when no provider is selected.
	 * - `true`: loads all models from all providers
	 * - `"base_models"`: loads distinct base model names (useful for governance where cross-provider matching is needed)
	 */
	loadModelsOnEmptyProvider?: boolean | "base_models";
	/** Prepends an "Allow All Models" option (value: "*") to the dropdown */
	allowAllOption?: boolean;
	/** When true with allowAllOption, the dropdown stays enabled without a provider and only offers the wildcard option. */
	allowAllOptionWithoutProvider?: boolean;
	/** id for the search input (accessibility) */
	inputId?: string;
	/** id of element that labels this control (accessibility) */
	ariaLabelledBy?: string;
	/** test selector for the container element */
	"data-testid"?: string;
	/** Menu position strategy. Use "absolute" inside popovers to avoid portal issues. Defaults to "fixed". */
	menuPosition?: "absolute" | "fixed";
	/** Target element for the menu portal. */
	menuPortalTarget?: HTMLElement | null;
	/** When true, allows typing custom model names even when a provider is selected. */
	allowCustomModels?: boolean;
	/** Additional model names to include in the dropdown (e.g. key-configured custom models). */
	extraModels?: string[];
}

interface ModelMultiselectPropsSingle extends ModelMultiselectPropsBase {
	/** Single select mode - value and onChange will be string instead of string[] */
	isSingleSelect: true;
	unfiltered?: boolean;
	value: string;
	onChange: (model: string) => void;
	clearable?: boolean;
}

interface ModelMultiselectPropsMulti extends ModelMultiselectPropsBase {
	/** Multi select mode (default) - value and onChange will be string[] */
	isSingleSelect?: false;
	unfiltered?: boolean;
	value: string[];
	onChange: (models: string[]) => void;
	clearable?: boolean;
}

export type ModelMultiselectProps = ModelMultiselectPropsSingle | ModelMultiselectPropsMulti;

interface ModelOption {
	label: string;
	value: string;
	provider?: string;
}

function filterModelsByProvider(models: ModelResponse[] | undefined, provider?: string): ModelResponse[] {
	return filterModelsForProviderListing(models, provider);
}

function toModelOptions(models: ModelResponse[]): ModelOption[] {
	const seen = new Set<string>();
	const options: ModelOption[] = [];
	for (const model of models) {
		if (seen.has(model.name)) {
			continue;
		}
		seen.add(model.name);
		options.push({
			label: model.name,
			value: model.name,
			provider: model.provider,
		});
	}
	return options;
}

function mergeExtraModelOptions(
	options: ModelOption[],
	extraModels: string[] | undefined,
	provider: string | undefined,
	query?: string,
): ModelOption[] {
	if (!extraModels?.length) {
		return options;
	}
	const seen = new Set(options.map((option) => option.value));
	const merged = [...options];
	const normalizedQuery = query?.trim().toLowerCase() ?? "";
	for (const model of extraModels) {
		if (!model || model === "*" || seen.has(model)) {
			continue;
		}
		if (normalizedQuery && !model.toLowerCase().includes(normalizedQuery)) {
			continue;
		}
		seen.add(model);
		merged.push({ label: model, value: model, provider });
	}
	return merged;
}

function buildModelsQueryArgs(
	provider: string | undefined,
	keys: string[] | undefined,
	vks: string[] | undefined,
	unfiltered: boolean,
	limit: number,
	query?: string,
): GetModelsRequest {
	return {
		query: query || undefined,
		provider: provider || undefined,
		keys: keys && keys.length > 0 ? keys : undefined,
		vks: vks && vks.length > 0 ? vks : undefined,
		limit,
		unfiltered,
	};
}

export function ModelMultiselect(props: ModelMultiselectProps) {
	const t = useT();
	const allModelsOption: ModelOption = useMemo(() => ({ label: t("shared.modelMultiselect.allModels"), value: "*" }), [t]);
	const {
		provider,
		keys,
		vks,
		value,
		unfiltered = false,
		onChange,
		placeholder = t("shared.modelMultiselect.searchModels"),
		disabled = false,
		className,
		loadModelsOnEmptyProvider = false,
		allowAllOption = false,
		allowAllOptionWithoutProvider = false,
		allowCustomModels = false,
		extraModels,
		clearable = false,
	} = props;
	const isSingleSelect = props.isSingleSelect === true;

	const providerScoped = !!provider;
	const creatable = allowCustomModels || !providerScoped;
	const shouldUseBaseModels = loadModelsOnEmptyProvider === "base_models" && !provider;
	const shouldLoadOnEmpty = !!loadModelsOnEmptyProvider;
	const wildcardOnlyWithoutProvider = allowAllOptionWithoutProvider && allowAllOption && !provider;

	const initialModelsArgs = useMemo(() => buildModelsQueryArgs(provider, keys, vks, unfiltered, 20), [provider, keys, vks, unfiltered]);
	const unscopedModelsArgs = useMemo(() => buildModelsQueryArgs(undefined, keys, vks, unfiltered, 20), [keys, vks, unfiltered]);

	// Provider-scoped catalog: subscribed query keyed by provider — avoids lazy-query cache bleed across dropdowns.
	const {
		data: providerModelsData,
		isFetching: isProviderModelsFetching,
		refetch: refetchProviderModels,
	} = useGetModelsQuery(initialModelsArgs, { skip: !providerScoped });

	const { data: unscopedModelsData, isFetching: isUnscopedModelsFetching } = useGetModelsQuery(unscopedModelsArgs, {
		skip: providerScoped || shouldUseBaseModels || !shouldLoadOnEmpty || wildcardOnlyWithoutProvider,
	});

	const [searchModels] = useLazyGetModelsQuery();
	const [getBaseModels, { data: baseModelsData, isLoading: isLoadingBaseModels }] = useLazyGetBaseModelsQuery();
	const [inputValue, setInputValue] = useState("");
	const inputValueRef = useRef("");

	const scopedModels = useMemo(() => {
		if (providerScoped) return filterModelsByProvider(providerModelsData?.models, provider);
		if (shouldLoadOnEmpty && !shouldUseBaseModels) return unscopedModelsData?.models ?? [];
		return [];
	}, [providerScoped, providerModelsData?.models, provider, shouldLoadOnEmpty, shouldUseBaseModels, unscopedModelsData?.models]);

	// Convert value to options (handle both single and multi select)
	const stringValue = value as string;
	const arrayValue = value as string[];
	const selectedOptions: ModelOption[] = isSingleSelect
		? stringValue
			? [{ label: stringValue, value: stringValue }]
			: []
		: arrayValue.map((model) => (model === "*" ? allModelsOption : { label: model, value: model }));

	useEffect(() => {
		if (shouldUseBaseModels) {
			getBaseModels({ limit: 20 });
		}
	}, [shouldUseBaseModels, getBaseModels]);

	// Load options function for AsyncMultiSelect
	const loadOptions = useCallback(
		(query: string, callback: (options: ModelOption[]) => void) => {
			const prefix: ModelOption[] = allowAllOption && (!query || "all models".includes(query.toLowerCase())) ? [allModelsOption] : [];

			if (!provider && !shouldLoadOnEmpty) {
				callback(prefix);
				return;
			}

			if (wildcardOnlyWithoutProvider) {
				callback(prefix);
				return;
			}

			if (shouldUseBaseModels) {
				getBaseModels({
					query: query || undefined,
					limit: query ? 50 : 20,
				})
					.unwrap()
					.then((response) => {
						const options = response.models.map((model) => ({
							label: model,
							value: model,
						}));
						callback([...prefix, ...options]);
					})
					.catch(() => {
						callback(prefix);
					});
				return;
			}

			if (providerScoped) {
				searchModels(buildModelsQueryArgs(provider, keys, vks, unfiltered, query ? 50 : 20, query))
					.unwrap()
					.then((response) => {
						const options = mergeExtraModelOptions(
							[...prefix, ...toModelOptions(filterModelsByProvider(response.models, provider))],
							extraModels,
							provider,
							query,
						);
						callback(options);
					})
					.catch(() => {
						callback(mergeExtraModelOptions(prefix, extraModels, provider, query));
					});
				return;
			}

			searchModels(buildModelsQueryArgs(undefined, keys, vks, unfiltered, query ? 50 : 20, query))
				.unwrap()
				.then((response) => {
					callback([...prefix, ...toModelOptions(response.models)]);
				})
				.catch(() => {
					callback(prefix);
				});
		},
		[
			allowAllOption,
			getBaseModels,
			keys,
			provider,
			providerScoped,
			searchModels,
			shouldLoadOnEmpty,
			shouldUseBaseModels,
			extraModels,
			unfiltered,
			vks,
			wildcardOnlyWithoutProvider,
		],
	);

	const handleChange = useCallback(
		(options: Option<ModelOption>[]) => {
			if (isSingleSelect) {
				const selected = options[0];
				(onChange as (model: string) => void)(selected?.value || "");
			} else {
				const modelNames = options.map((opt) => opt.value);
				(onChange as (models: string[]) => void)(modelNames);
			}

			const currentQuery = inputValueRef.current;
			if (providerScoped) {
				void refetchProviderModels();
				if (currentQuery) {
					void searchModels(buildModelsQueryArgs(provider, keys, vks, unfiltered, 20, currentQuery));
				}
			} else if (shouldUseBaseModels) {
				getBaseModels({
					query: currentQuery || undefined,
					limit: currentQuery ? 20 : 20,
				});
			} else if (shouldLoadOnEmpty) {
				searchModels(buildModelsQueryArgs(undefined, keys, vks, unfiltered, 20, currentQuery || undefined));
			}
		},
		[
			onChange,
			provider,
			providerScoped,
			keys,
			vks,
			searchModels,
			refetchProviderModels,
			isSingleSelect,
			shouldLoadOnEmpty,
			shouldUseBaseModels,
			getBaseModels,
			unfiltered,
		],
	);

	const handleInputChange = useCallback(
		(newValue: string, actionMeta: { action: string }) => {
			if (!isSingleSelect && (actionMeta.action === "input-blur" || actionMeta.action === "menu-close")) {
				return;
			}
			setInputValue(newValue);
			inputValueRef.current = newValue;
		},
		[isSingleSelect],
	);

	const defaultOptions: ModelOption[] = useMemo(() => {
		const prefix = allowAllOption ? [allModelsOption] : [];
		if (shouldUseBaseModels) {
			return [
				...prefix,
				...(baseModelsData?.models?.map((model) => ({
					label: model,
					value: model,
				})) || []),
			];
		}
		if (providerScoped) {
			return mergeExtraModelOptions([...prefix, ...toModelOptions(scopedModels)], extraModels, provider);
		}
		if (shouldLoadOnEmpty && !shouldUseBaseModels) {
			return [...prefix, ...toModelOptions(scopedModels)];
		}
		return prefix;
	}, [
		scopedModels,
		baseModelsData?.models,
		shouldUseBaseModels,
		shouldLoadOnEmpty,
		allowAllOption,
		providerScoped,
		extraModels,
		provider,
		allModelsOption,
	]);

	const shouldBeDisabled = disabled || (!provider && !shouldLoadOnEmpty && !wildcardOnlyWithoutProvider);
	const isLoading = providerScoped
		? isProviderModelsFetching
		: shouldUseBaseModels
			? isLoadingBaseModels
			: shouldLoadOnEmpty
				? isUnscopedModelsFetching
				: false;

	return (
		<AsyncMultiSelect<ModelOption>
			isSingleSelect={isSingleSelect}
			hideSelectedOptions
			inputId={props.inputId}
			ariaLabelledBy={props.ariaLabelledBy}
			data-testid={props["data-testid"]}
			value={selectedOptions}
			onChange={handleChange}
			reload={loadOptions}
			debounce={300}
			isCreatable={creatable}
			dynamicOptionCreation={creatable}
			createOptionText={t("shared.modelMultiselect.createOption")}
			selectKey={[
				provider ?? "",
				keys?.join(",") ?? "",
				vks?.join(",") ?? "",
				String(unfiltered),
				String(shouldUseBaseModels),
				extraModels?.join(",") ?? "",
			].join("|")}
			defaultOptions={defaultOptions.length > 0 ? defaultOptions : ([] as Option<ModelOption>[])}
			isLoading={isLoading}
			placeholder={placeholder}
			disabled={shouldBeDisabled}
			className={cn("!min-h-9 w-full", className)}
			triggerClassName="!shadow-none !border-border !min-h-9 px-1"
			menuClassName="!z-[100] max-h-[300px] overflow-y-auto w-full cursor-pointer custom-scrollbar"
			isClearable={clearable}
			closeMenuOnSelect={isSingleSelect}
			menuPlacement="auto"
			menuPosition={props.menuPosition}
			menuPortalTarget={props.menuPortalTarget}
			menuListClassName="mx-1"
			inputValue={inputValue}
			onInputChange={handleInputChange}
			noResultsFoundPlaceholder={t("shared.modelMultiselect.noModelsFound")}
			emptyResultPlaceholder={
				provider || shouldLoadOnEmpty || wildcardOnlyWithoutProvider
					? wildcardOnlyWithoutProvider
						? t("shared.modelMultiselect.selectAnyOrProvider")
						: t("shared.modelMultiselect.startTyping")
					: t("shared.modelMultiselect.selectProviderFirst")
			}
			views={{
				dropdownIndicator: isSingleSelect ? undefined : () => <></>,
				singleValue: isSingleSelect
					? (singleValueProps: SingleValueProps<ModelOption>) => (
							<span className="absolute left-1.5 text-sm">{singleValueProps.data.label}</span>
						)
					: undefined,
				multiValue: isSingleSelect
					? undefined
					: (multiValueProps: MultiValueProps<ModelOption>) => {
							return (
								<div
									{...multiValueProps.innerProps}
									className="bg-accent text-accent-foreground flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-sm"
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
				option: (optionProps: OptionProps<ModelOption>) => {
					const { Option } = components;
					return (
						<Option
							{...optionProps}
							className={cn(
								"flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm",
								(optionProps.isFocused || optionProps.isSelected) && "bg-accent text-accent-foreground",
							)}
						>
							<span className="grow truncate text-sm">{optionProps.data.label}</span>
						</Option>
					);
				},
			}}
		/>
	);
}