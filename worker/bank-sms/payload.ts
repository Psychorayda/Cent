import type { BankSmsPayload } from "./types";

const MAX_BODY = 8192;

function unescapeLoose(value: string): string {
	return value
		.replace(/\\n/g, "\n")
		.replace(/\\r/g, "\r")
		.replace(/\\t/g, "\t")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\");
}

/**
 * 兼容 SMSForwarder 的模板：
 * {"from":"{{FROM}}","content":"{{SMS}}","ts":"{{RECEIVE_TIME}}"}
 *
 * 如果短信内容里带引号导致 JSON 非法，用容错正则再试一次。
 */
export function parsePayloadText(
	text: string,
): { ok: true; payload: BankSmsPayload } | { ok: false; reason: string } {
	if (!text || text.length > MAX_BODY) {
		return { ok: false, reason: "body-too-large" };
	}

	let data: any;
	try {
		data = JSON.parse(text);
	} catch {
		data = parseLoose(text);
	}

	if (!data || typeof data !== "object") {
		return { ok: false, reason: "invalid-json" };
	}

	const from = String(data.from ?? "").trim();
	const content = String(data.content ?? "").trim();
	const ts = data.ts ?? "";

	if (!content) {
		return { ok: false, reason: "missing-content" };
	}

	return {
		ok: true,
		payload: {
			from,
			content,
			ts,
		},
	};
}

function parseLoose(text: string): any | null {
	const from = text.match(/"from"\s*:\s*"([^"]*)"/)?.[1];
	const ts = text.match(/"ts"\s*:\s*"([^"]*)"/)?.[1];

	// content 放在 from 和 ts 中间，允许里面出现转义字符
	const contentMatch = text.match(
		/"content"\s*:\s*"([\s\S]*)"\s*,\s*"ts"\s*:/,
	);
	const content = contentMatch ? unescapeLoose(contentMatch[1]) : undefined;

	if (from === undefined && content === undefined) {
		return null;
	}
	return {
		from: from ?? "",
		content: content ?? "",
		ts: ts ?? "",
	};
}
