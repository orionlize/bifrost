import { Button } from "@/components/ui/button";
import { LoginBrandHeader } from "@/components/loginBrandHeader";
import {
	copyAccessTokenToClipboard,
	openZdSwitchDeeplink,
	resolveZdSwitchSuccessParams,
	stashZdSwitchAuth,
} from "@/lib/utils/zdSwitchLogin";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export default function ZdSwitchSuccessPage() {
	const { accessToken, baseUrl } = useMemo(() => {
		if (typeof window === "undefined") {
			return { accessToken: "", baseUrl: null };
		}
		return resolveZdSwitchSuccessParams(window.location.search);
	}, []);
	const [copied, setCopied] = useState(false);
	const [deeplinkAttempted, setDeeplinkAttempted] = useState(false);

	useEffect(() => {
		if (!accessToken || !baseUrl) {
			return;
		}
		stashZdSwitchAuth(baseUrl, accessToken);
	}, [accessToken, baseUrl]);

	useEffect(() => {
		if (!accessToken || deeplinkAttempted) {
			return;
		}
		setDeeplinkAttempted(true);
		const timer = window.setTimeout(() => {
			openZdSwitchDeeplink(accessToken, baseUrl);
		}, 500);
		return () => window.clearTimeout(timer);
	}, [accessToken, baseUrl, deeplinkAttempted]);

	const handleOpenApp = () => {
		if (!accessToken) {
			return;
		}
		openZdSwitchDeeplink(accessToken, baseUrl);
	};

	const handleCopyToken = async () => {
		if (!accessToken) {
			return;
		}
		const ok = await copyAccessTokenToClipboard(accessToken);
		if (ok) {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			<div className="w-full max-w-md">
				<div className="border-border bg-card w-full space-y-6 rounded-sm border p-8">
					<LoginBrandHeader />

					{accessToken ? (
						<div className="space-y-5 text-center">
							<div className="flex justify-center">
								<CheckCircle2 className="text-primary h-12 w-12" />
							</div>
							<div className="space-y-2">
								<h1 className="text-lg font-semibold">登录成功</h1>
								<p className="text-muted-foreground text-sm">正在打开 ZD Switch 应用。如果没有自动跳转，请点击下方按钮。</p>
								{baseUrl ? <p className="text-muted-foreground text-xs break-all">服务地址：{baseUrl}</p> : null}
							</div>
							<Button type="button" className="h-9 w-full text-sm" onClick={handleOpenApp} data-testid="zd-switch-open-deeplink-button">
								打开 ZD Switch
							</Button>
							<Button
								type="button"
								variant="outline"
								className="h-9 w-full text-sm"
								onClick={() => void handleCopyToken()}
								data-testid="zd-switch-copy-token-button"
							>
								{copied ? "已复制 Access Token" : "复制 Access Token"}
							</Button>
						</div>
					) : (
						<div className="space-y-2 text-center">
							<h1 className="text-lg font-semibold">登录未完成</h1>
							<p className="text-muted-foreground text-sm">缺少 access_token，请返回登录页重新授权。</p>
							<Button
								type="button"
								variant="outline"
								className="h-9 w-full text-sm"
								onClick={() => {
									window.location.href = `/login?source=zd-switch`;
								}}
								data-testid="zd-switch-retry-login-button"
							>
								返回登录
							</Button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}