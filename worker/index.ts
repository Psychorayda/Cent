import type { Env } from "./config";
import {
	handleAck,
	handleBankSms,
	handleHealth,
	handleInbox,
} from "./bank-sms/handler";
import { json } from "./lib";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		try {
			if (url.pathname === "/api/health") {
				return handleHealth();
			}
			if (url.pathname === "/api/bank-sms") {
				return await handleBankSms(request, env);
			}
			if (url.pathname === "/api/inbox") {
				return await handleInbox(request, env);
			}
			if (url.pathname === "/api/inbox/ack") {
				return await handleAck(request, env);
			}
			if (url.pathname.startsWith("/api/")) {
				return json({ ok: false, error: "not-found" }, 404);
			}
			return env.ASSETS.fetch(request);
		} catch (error) {
			console.error("cent worker error", error);
			return json({ ok: false, error: "internal" }, 500);
		}
	},
};
