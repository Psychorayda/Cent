import {
	amountFromYuan,
	inferDate,
	normalizeMerchant,
	preview,
	splitInner,
} from "../../lib";
import type { BankSmsPayload, Direction, NormalizedTx } from "../types";

const EXCLUDE =
	/验证码|校验码|动态码|密码|登录|积分|优惠|活动|额度|账单|最低还款|余额不足|余额提醒|申请|办理|分期|失败|撤销|取消|退订|贷款|理财推荐|保险/;

const EXPENSE_WORDS = [
	"支出",
	"消费",
	"扣款",
	"付款",
	"支付",
	"取现",
	"还款",
	"手续费",
	"转出",
];
const INCOME_WORDS = [
	"收入",
	"入账",
	"转入",
	"到账",
	"存入",
	"退款",
	"退回",
	"冲正",
];

function detectDirection(text: string): Direction | undefined {
	const expenseIndex = EXPENSE_WORDS.map((w) => text.indexOf(w)).filter(
		(i) => i >= 0,
	);
	const incomeIndex = INCOME_WORDS.map((w) => text.indexOf(w)).filter(
		(i) => i >= 0,
	);
	const exp = expenseIndex.length ? Math.min(...expenseIndex) : Infinity;
	const inc = incomeIndex.length ? Math.min(...incomeIndex) : Infinity;
	if (exp === Infinity && inc === Infinity) return undefined;
	return exp <= inc ? "expense" : "income";
}

function parseGenericTime(content: string, receivedAt: number): number {
	const cn = content.match(
		/(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/,
	);
	if (cn) {
		return inferDate(
			receivedAt,
			Number(cn[1]),
			Number(cn[2]),
			Number(cn[3]),
			Number(cn[4]),
		);
	}

	const iso = content.match(
		/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/,
	);
	if (iso) {
		return inferDate(
			receivedAt,
			Number(iso[2]),
			Number(iso[3]),
			Number(iso[4]),
			Number(iso[5]),
		);
	}

	return receivedAt;
}

export function parseGeneric(
	payload: BankSmsPayload,
	rawHash: string,
	receivedAt: number,
	bank?: string,
): NormalizedTx | null {
	const content = payload.content.trim();
	if (EXCLUDE.test(content)) return null;

	const balanceMatch = content.match(
		/余额\s*([\d,]+(?:\.\d{1,2})?)\s*元/,
	);
	const balance = balanceMatch ? amountFromYuan(balanceMatch[1]) : undefined;

	// 先按“余额”切掉后半段，避免把余额当交易金额
	const txPart = content.split(/[，,]?\s*余额/)[0] ?? content;
	const direction = detectDirection(txPart);
	if (!direction) return null;

	const amountMatches = Array.from(
		txPart.matchAll(/([\d,]+(?:\.\d{1,2})?)\s*元/g),
	);
	if (amountMatches.length === 0) return null;
	const amountText = amountMatches[0][1];
	const amountYuan = Number(amountText.replace(/,/g, ""));
	if (!Number.isFinite(amountYuan) || amountYuan <= 0) return null;

	const cardTail =
		content.match(/尾号\s*(\d{4})/)?.[1] ??
		content.match(/(?:卡号后四位|账户)\D{0,6}(\d{4})/)?.[1];

	const inner = content.match(/[（(]([^）)]+)[）)]/)?.[1];
	const split = inner
		? splitInner(inner)
		: { subtype: "unknown", channel: "", merchant: "" };

	let merchant = split.merchant;
	if (!merchant) {
		merchant =
			content.match(/(?:付款给|收款方|商户)[:：]?\s*([^，,。]+)/)?.[1] ??
			content.match(/在\s*([^，,。]+?)\s*消费/)?.[1] ??
			"";
	}

	return {
		source: "bank-sms",
		bank,
		cardTail,
		direction,
		subtype: split.subtype,
		channel: split.channel || undefined,
		amount: amountFromYuan(amountText),
		amountYuan,
		currency: "CNY",
		occurredAt: parseGenericTime(content, receivedAt),
		merchant: normalizeMerchant(merchant) || undefined,
		balance,
		rawHash,
		rawPreview: preview(content),
		parser: "generic",
		confidence: "medium",
	};
}
