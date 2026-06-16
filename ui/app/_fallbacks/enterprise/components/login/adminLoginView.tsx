import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageSwitcher } from "@/components/languageSwitcher";
import { LoginBrandHeader } from "@/components/loginBrandHeader";
import { getErrorMessage, useIsAuthEnabledQuery, useLoginMutation } from "@/lib/store/apis";
import { useT } from "@/lib/i18n";
import { probeAuthSession } from "@/lib/utils/authRedirect";
import { getEndpointUrl } from "@/lib/utils/port";
import { useSearch } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

function readLoginErrorFromLocation(): string {
	if (typeof window === "undefined") {
		return "";
	}
	return new URLSearchParams(window.location.search).get("error")?.trim() ?? "";
}

const ADMIN_POST_LOGIN_PATH = "/workspace/dashboard";

export default function AdminLoginView() {
	const t = useT();
	const search = useSearch({ strict: false }) as { error?: string };
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [errorMessage, setErrorMessage] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [login, { isLoading: isLoggingIn }] = useLoginMutation();
	const { data: authState, isLoading: authLoading, isFetching: authFetching } = useIsAuthEnabledQuery();
	const authReady = !authLoading && !authFetching && authState !== undefined;
	const showPasswordForm = authState?.is_auth_enabled === true;

	useEffect(() => {
		const error = search.error ?? readLoginErrorFromLocation();
		if (error) {
			setErrorMessage(error);
		}
	}, [search.error]);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setIsLoading(true);
		setErrorMessage("");
		try {
			await login({ username, password }).unwrap();
			const auth = await probeAuthSession();
			if (auth?.is_local_admin_session !== true) {
				setErrorMessage(t("auth.adminSessionNotEstablished"));
				return;
			}
			window.location.replace(getEndpointUrl(ADMIN_POST_LOGIN_PATH));
		} catch (error) {
			setErrorMessage(getErrorMessage(error));
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

					<div className="space-y-1 text-center">
						<h1 className="text-lg font-semibold">{t("auth.adminSignInTitle")}</h1>
						<p className="text-muted-foreground text-sm">{t("auth.adminSignInDescription")}</p>
					</div>

					{!authReady ? (
						<div className="flex items-center justify-center py-8">
							<Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
						</div>
					) : (
						<form onSubmit={handleSubmit} className="space-y-5" data-testid="admin-login-form">
							{errorMessage && <div className="bg-destructive/10 text-destructive rounded-sm p-3 text-sm">{errorMessage}</div>}

							{showPasswordForm ? (
								<>
									<div className="space-y-2">
										<Label htmlFor="admin-username" className="text-sm font-medium">
											{t("auth.username")}
										</Label>
										<Input
											id="admin-username"
											type="text"
											placeholder={t("auth.usernamePlaceholder")}
											value={username}
											onChange={(e) => setUsername(e.target.value)}
											required
											className="text-sm"
											autoComplete="username"
											data-testid="admin-login-username"
										/>
									</div>

									<div className="space-y-2">
										<Label htmlFor="admin-password" className="text-sm font-medium">
											{t("auth.password")}
										</Label>
										<div className="relative">
											<Input
												id="admin-password"
												type={showPassword ? "text" : "password"}
												placeholder={t("auth.passwordPlaceholder")}
												value={password}
												onChange={(e) => setPassword(e.target.value)}
												required
												className="pr-10 text-sm"
												autoComplete="current-password"
												data-testid="admin-login-password"
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

									<Button
										type="submit"
										className="h-9 w-full text-sm"
										isLoading={isLoading}
										disabled={isLoading}
										data-testid="admin-login-submit"
									>
										{isLoading || isLoggingIn ? t("auth.signingIn") : t("auth.signIn")}
									</Button>
								</>
							) : (
								<p className="text-muted-foreground text-center text-sm">{t("auth.redirecting")}</p>
							)}
						</form>
					)}
				</div>
			</div>
		</div>
	);
}
