const BANK_BY_SENDER: Record<string, string> = {
	"95555": "招商银行",
	"95588": "工商银行",
	"95533": "建设银行",
	"95599": "农业银行",
	"95566": "中国银行",
	"95559": "交通银行",
	"95580": "邮储银行",
	"95558": "中信银行",
	"95595": "光大银行",
	"95561": "兴业银行",
	"95528": "浦发银行",
	"95568": "民生银行",
	"95511": "平安银行",
	"95508": "广发银行",
	"95577": "华夏银行",
	"95501": "平安银行",
	"95509": "北京银行",
};

const BANK_NAMES = Array.from(new Set(Object.values(BANK_BY_SENDER)));

export function normalizeFrom(raw: string): {
	raw: string;
	digits: string;
	fromType: "digits" | "text";
	bank?: string;
} {
	const trimmed = raw.trim();
	let digits = trimmed.replace(/[^\d]/g, "");
	// +86 / 86 前缀
	if (digits.startsWith("86") && digits.length > 6) {
		digits = digits.slice(2);
	}
	const bank = detectBankBySender(digits) ?? detectBankByText(trimmed);
	return {
		raw: trimmed,
		digits,
		fromType: digits ? "digits" : "text",
		bank,
	};
}

export function detectBankBySender(digits: string): string | undefined {
	if (!digits) return undefined;
	const keys = Object.keys(BANK_BY_SENDER).sort(
		(a, b) => b.length - a.length,
	);
	for (const key of keys) {
		if (digits === key || digits.endsWith(key) || digits.includes(key)) {
			return BANK_BY_SENDER[key];
		}
	}
	return undefined;
}

export function detectBankByText(text: string): string | undefined {
	const bracket = text.match(/【([^】]+)】/)?.[1];
	if (bracket) {
		for (const name of BANK_NAMES) {
			if (bracket.includes(name)) return name;
		}
	}
	for (const name of BANK_NAMES) {
		if (text.includes(name)) return name;
	}
	return undefined;
}

export type TsInfo = {
	ms: number;
	type: "ms" | "s" | "datetime" | "iso" | "invalid";
};

export function parseTs(ts: string | number): TsInfo {
	if (typeof ts === "number" && Number.isFinite(ts)) {
		return ts > 1e12
			? { ms: ts, type: "ms" }
			: { ms: Math.round(ts * 1000), type: "s" };
	}

	const value = String(ts ?? "").trim();
	if (/^\d{13}$/.test(value)) {
		return { ms: Number(value), type: "ms" };
	}
	if (/^\d{10}$/.test(value)) {
		return { ms: Number(value) * 1000, type: "s" };
	}

	if (/^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?$/.test(value)) {
		const normalized = value.replace(" ", "T");
		const ms = Date.parse(`${normalized}+08:00`);
		if (!Number.isNaN(ms)) {
			return { ms, type: "datetime" };
		}
	}

	const ms = Date.parse(value);
	if (!Number.isNaN(ms)) {
		return { ms, type: "iso" };
	}

	return { ms: Date.now(), type: "invalid" };
}
