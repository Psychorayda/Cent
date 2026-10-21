export const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		},
	});

export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let out = 0;
	for (let i = 0; i < a.length; i += 1) {
		out |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return out === 0;
}

export function preview(text: string, length = 60): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	return normalized.length > length
		? `${normalized.slice(0, length)}…`
		: normalized;
}

/** 元字符串 -> 整数金额（×10000） */
export function amountFromYuan(value: string): number {
	const n = Number(value.replace(/,/g, "").trim());
	if (!Number.isFinite(n)) return 0;
	return Math.round(n * 10000);
}

const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const HALF_YEAR = 180 * ONE_DAY;

/**
 * 根据短信里的“X月X日 HH:mm”推断年份，并固定按 Asia/Shanghai 生成时间戳。
 */
export function inferDate(
	receivedAt: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
): number {
	const baseYear = new Date(receivedAt + EIGHT_HOURS).getUTCFullYear();
	const build = (year: number) =>
		Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0);

	let candidate = build(baseYear);
	if (candidate - receivedAt > ONE_DAY) {
		candidate = build(baseYear - 1);
	} else if (receivedAt - candidate > HALF_YEAR) {
		candidate = build(baseYear + 1);
	}
	return candidate;
}

export function normalizeMerchant(value?: string): string {
	if (!value) return "";
	return value
		.replace(/^(财付通|支付宝|拼多多支付|银联|快捷支付|微信支付)-/, "")
		.replace(/\s+/g, "")
		.replace(/[。；;]+$/g, "")
		.trim();
}

export function splitInner(inner: string): {
	subtype: string;
	channel: string;
	merchant: string;
} {
	const subtypes = [
		"充值",
		"缴费",
		"消费",
		"退款",
		"转账",
		"他行汇入",
		"银联入账",
	];
	const channels = [
		"拼多多支付",
		"快捷支付",
		"微信支付",
		"财付通",
		"支付宝",
		"银联",
	];

	let rest = inner.trim();
	let subtype = "";
	for (const item of subtypes) {
		if (rest.startsWith(item)) {
			subtype = item;
			rest = rest.slice(item.length);
			break;
		}
	}

	let channel = "";
	for (const item of channels) {
		if (rest.startsWith(`${item}-`)) {
			channel = item;
			rest = rest.slice(item.length + 1);
			break;
		}
	}

	return {
		subtype: subtype || "unknown",
		channel,
		merchant: normalizeMerchant(rest),
	};
}
