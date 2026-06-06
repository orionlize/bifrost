import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageSwitcher } from "@/components/languageSwitcher";
import { LoginBrandHeader } from "@/components/loginBrandHeader";
import { useAppDispatch } from "@/lib/store";
import { configApi, getErrorMessage, sessionApi, useIsAuthEnabledQuery, useLoginMutation } from "@/lib/store/apis";
import { DEFAULT_POST_LOGIN_PATH } from "@/lib/utils/loginGoto";
import {
	navigateToAoneOAuthAuthorize,
	navigateToZwitchHandoff,
	useIsZwitchLoginSource,
	useLoginRedirectUriFromUrl,
} from "@/lib/hooks/useLoginRedirectUri";
import { executePostLoginRedirect } from "@/lib/utils/postLoginRedirect";
import { useT } from "@/lib/i18n";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export default function LoginView() {
	const t = useT();
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [errorMessage, setErrorMessage] = useState("");
	const navigate = useNavigate();
	const search = useSearch({ strict: false }) as { error?: string; redirect_uri?: string };
	const loginRedirectUri = useLoginRedirectUriFromUrl();
	const isZwitchSource = useIsZwitchLoginSource();
	const [isLoading, setIsLoading] = useState(false);
	const [login, { isLoading: isLoggingIn }] = useLoginMutation();
	const dispatch = useAppDispatch();
	const { data: authState, isLoading: authLoading, isFetching: authFetching } = useIsAuthEnabledQuery();
	const authReady = !authLoading && !authFetching && authState !== undefined;
	const postLoginPath = loginRedirectUri ?? DEFAULT_POST_LOGIN_PATH;
	const aoneOAuthEnabled = authState?.aone_oauth_enabled === true;
	const showPasswordForm = authState?.is_auth_enabled === true && !isZwitchSource;
	const shouldRedirectToZwitchHandoff =
		authReady && isZwitchSource && authState?.has_valid_token === true && authState?.is_aone_user_session === true;
	const shouldRedirectAway =
		authReady &&
		authState !== undefined &&
		!isZwitchSource &&
		loginRedirectUri != null &&
		(!authState.is_auth_enabled || authState.has_valid_token);

	useEffect(() => {
		if (shouldRedirectToZwitchHandoff) {
			navigateToZwitchHandoff();
			return;
		}
		if (!shouldRedirectAway || !authState) {
			return;
		}
		if (loginRedirectUri) {
			void executePostLoginRedirect(loginRedirectUri);
			return;
		}
		navigate({ to: DEFAULT_POST_LOGIN_PATH, replace: true });
	}, [authState, loginRedirectUri, navigate, shouldRedirectAway, shouldRedirectToZwitchHandoff]);

	useEffect(() => {
		if (!authReady || !isZwitchSource || !aoneOAuthEnabled || search.error) {
			return;
		}
		if (shouldRedirectToZwitchHandoff || shouldRedirectAway) {
			return;
		}
		navigateToAoneOAuthAuthorize();
	}, [
		aoneOAuthEnabled,
		authReady,
		isZwitchSource,
		search.error,
		shouldRedirectAway,
		shouldRedirectToZwitchHandoff,
	]);

	useEffect(() => {
		if (search.error) {
			setErrorMessage(search.error);
		}
	}, [search.error]);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		setIsLoading(true);
		e.preventDefault();
		setErrorMessage("");
		try {
			await login({ username, password }).unwrap();
			const refreshedAuth = await dispatch(sessionApi.endpoints.isAuthEnabled.initiate(undefined, { forceRefetch: true })).unwrap();
			if (!refreshedAuth.has_valid_token) {
				setErrorMessage(t("auth.sessionNotEstablished"));
				return;
			}
			await dispatch(configApi.endpoints.getCoreConfig.initiate({}, { forceRefetch: true })).unwrap();
			if (loginRedirectUri) {
				await executePostLoginRedirect(loginRedirectUri);
				return;
			}
			navigate({ to: postLoginPath });
		} catch (error) {
			const message = getErrorMessage(error);
			setErrorMessage(message);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			<div className="absolute top-4 right-4">
				<LanguageSwitcher />
			</div>
			<div className="w-full max-w-md">
				<div className="border-border bg-card w-full space-y-6 rounded-sm border p-8">
					<LoginBrandHeader />

					{!authReady || shouldRedirectAway || shouldRedirectToZwitchHandoff ? (
						<div className="flex items-center justify-center py-8">
							<Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
						</div>
					) : (
						<form onSubmit={handleSubmit} className="space-y-5">
							{errorMessage && <div className="bg-destructive/10 text-destructive rounded-sm p-3 text-sm">{errorMessage}</div>}

							{aoneOAuthEnabled && (
								<Button
									type="button"
									variant="outline"
									className="h-9 w-full text-sm"
									onClick={() => {
										navigateToAoneOAuthAuthorize();
									}}
									data-testid="login-aone-oauth-button"
								>
									{t("auth.signInWithAone")}
								</Button>
							)}

							{aoneOAuthEnabled && showPasswordForm && (
								<div className="relative">
									<div className="absolute inset-0 flex items-center">
										<span className="w-full border-t" />
									</div>
									<div className="relative flex justify-center text-xs uppercase">
										<span className="bg-card text-muted-foreground px-2">{t("auth.orContinueWithPassword")}</span>
									</div>
								</div>
							)}

							{showPasswordForm && (
								<>
									<div className="space-y-2">
										<Label htmlFor="username" className="text-sm font-medium">
											{t("auth.username")}
										</Label>
										<Input
											id="username"
											type="text"
											placeholder={t("auth.usernamePlaceholder")}
											value={username}
											onChange={(e) => setUsername(e.target.value)}
											required
											className="text-sm"
											autoComplete="username"
										/>
									</div>

									<div className="space-y-2">
										<Label htmlFor="password" className="text-sm font-medium">
											{t("auth.password")}
										</Label>
										<div className="relative">
											<Input
												id="password"
												type={showPassword ? "text" : "password"}
												placeholder={t("auth.passwordPlaceholder")}
												value={password}
												onChange={(e) => setPassword(e.target.value)}
												required
												className="pr-10 text-sm"
												autoComplete="current-password"
											/>
											<button
												type="button"
												onClick={() => setShowPassword(!showPassword)}
												className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
												aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
											>
												{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
											</button>
										</div>
									</div>

									<Button type="submit" className="h-9 w-full text-sm" isLoading={isLoading} disabled={isLoading}>
										{isLoading || isLoggingIn ? t("auth.signingIn") : t("auth.signIn")}
									</Button>
								</>
							)}
						</form>
					)}
				</div>
			</div>
		</div>
	);
}