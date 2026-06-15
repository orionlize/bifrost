import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import { maximFormSchema, type MaximFormSchema } from "@/lib/types/schemas";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";

interface MaximFormFragmentProps {
	initialConfig?: {
		enabled?: boolean;
		api_key?: string;
		log_repo_id?: string;
	};
	onSave: (config: MaximFormSchema) => Promise<void>;
	onDelete?: () => void;
	isDeleting?: boolean;
	isLoading?: boolean;
}

export function MaximFormFragment({ initialConfig, onSave, onDelete, isDeleting = false, isLoading = false }: MaximFormFragmentProps) {
	const t = useT();
	const hasMaximAccess = useRbac(RbacResource.Observability, RbacOperation.Update);
	const [showApiKey, setShowApiKey] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	const form = useForm<MaximFormSchema, any, MaximFormSchema>({
		resolver: zodResolver(maximFormSchema) as Resolver<MaximFormSchema, any, MaximFormSchema>,
		mode: "onChange",
		reValidateMode: "onChange",
		defaultValues: {
			enabled: initialConfig?.enabled ?? true,
			maxim_config: {
				api_key: initialConfig?.api_key ?? "",
				log_repo_id: initialConfig?.log_repo_id ?? "",
			},
		},
	});

	const onSubmit = (data: MaximFormSchema) => {
		setIsSaving(true);
		onSave(data).finally(() => setIsSaving(false));
	};

	useEffect(() => {
		// Reset form with new initial config when it changes
		form.reset({
			enabled: initialConfig?.enabled ?? true,
			maxim_config: {
				api_key: initialConfig?.api_key ?? "",
				log_repo_id: initialConfig?.log_repo_id ?? "",
			},
		});
	}, [form, initialConfig]);

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
				<div className="space-y-4">
					<div className="grid grid-cols-1 gap-4">
						<FormField
							control={form.control}
							name="maxim_config.api_key"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("observabilityConnectors.maxim.apiKey")}</FormLabel>
									<FormControl>
										<div className="relative">
											<Input
												type={showApiKey ? "text" : "password"}
												placeholder={t("observabilityConnectors.maxim.apiKeyPlaceholder")}
												disabled={!hasMaximAccess}
												{...field}
												className="pr-10"
											/>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="absolute top-0 right-0 h-full px-3 py-2 hover:bg-transparent"
												onClick={() => setShowApiKey(!showApiKey)}
												disabled={!hasMaximAccess}
											>
												{showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
											</Button>
										</div>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="maxim_config.log_repo_id"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("observabilityConnectors.maxim.logRepoId")}</FormLabel>
									<FormControl>
										<Input
											placeholder={t("observabilityConnectors.maxim.logRepoPlaceholder")}
											disabled={!hasMaximAccess}
											{...field}
											value={field.value ?? ""}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					</div>
				</div>

				{/* Form Actions */}
				<div className="flex w-full flex-row items-center">
					<FormField
						control={form.control}
						name="enabled"
						render={({ field }) => (
							<FormItem className="flex items-center gap-2 py-2">
								<FormLabel className="text-muted-foreground text-sm font-medium">{t("observabilityConnectors.enabled")}</FormLabel>
								<FormControl>
									<Switch
										checked={field.value}
										onCheckedChange={field.onChange}
										disabled={!hasMaximAccess}
										data-testid="maxim-connector-enable-toggle"
									/>
								</FormControl>
							</FormItem>
						)}
					/>
					<div className="ml-auto flex justify-end space-x-2 py-2">
						{onDelete && (
							<Button
								type="button"
								variant="outline"
								onClick={onDelete}
								disabled={isDeleting}
								title={t("observabilityConnectors.deleteConnector")}
								aria-label={t("observabilityConnectors.deleteConnectorAria")}
							>
								<Trash2 className="size-4" />
							</Button>
						)}
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								form.reset({
									enabled: initialConfig?.enabled ?? true,
									maxim_config: {
										api_key: initialConfig?.api_key ?? "",
										log_repo_id: initialConfig?.log_repo_id ?? "",
									},
								});
							}}
							disabled={!hasMaximAccess || isLoading || !form.formState.isDirty}
						>
							{t("observabilityConnectors.reset")}
						</Button>
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button type="submit" disabled={!hasMaximAccess || !form.formState.isDirty} isLoading={isSaving}>
										{t("observabilityConnectors.maxim.save")}
									</Button>
								</TooltipTrigger>
								{!form.formState.isDirty && (
									<TooltipContent>
										<p>
											{!form.formState.isDirty
												? t("observabilityConnectors.noChangesWithErrors")
												: !form.formState.isDirty
													? t("observabilityConnectors.noChanges")
													: t("observabilityConnectors.fixValidation")}
										</p>
									</TooltipContent>
								)}
							</Tooltip>
						</TooltipProvider>
					</div>
				</div>
			</form>
		</Form>
	);
}