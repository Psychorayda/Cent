import type { Env } from "../config";
import { safeEqual, sha256Hex } from "../lib";

function getBearer(request: Request): string | undefined {
	const auth = request.headers.get("Authorization") ?? "";
	if (auth.toLowerCase().startsWith("bearer ")) {
		return auth.slice(7).trim();
	}
	return undefined;
}

export function checkSmsAuth(request: Request, env: Env): boolean {
	const expected = env.BANK_SMS_TOKEN ?? "";
	if (!expected) return false;

	const provided =
		request.headers.get("X-Cent-Token") ??
		getBearer(request) ??
		"";
	return safeEqual(provided, expected);
}

export async function checkInboxAuth(
	request: Request,
	env: Env,
): Promise<boolean> {
	const token = getBearer(request);
	if (!token) return false;

	const ownerId = env.OWNER_GITHUB_ID?.trim();
	if (!ownerId) return false;

	const tokenHash = await sha256Hex(token);
	const cacheKey = `auth:${tokenHash}`;
	const cached = await env.INBOX_KV.get(cacheKey);
	if (cached) {
		return cached === ownerId;
	}

	const res = await fetch("https://api.github.com/user", {
		headers: {
			Authorization: `Bearer ${token}`,
			"User-Agent": "cent-worker",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (!res.ok) return false;

	const data: any = await res.json();
	const id = String(data?.id ?? "");
	if (!id) return false;

	await env.INBOX_KV.put(cacheKey, id, { expirationTtl: 600 });
	return id === ownerId;
}
