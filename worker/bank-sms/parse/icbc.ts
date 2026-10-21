import { amountFromYuan, inferDate, preview, splitInner } from "../../lib";
import type { BankSmsPayload, NormalizedTx } from "../types";

/**
 * 工行动账短信专用解析：
 * 尾号4571卡10月10日10:39支出(消费财付通-亳州蒙城万达店)45.60元，余额77,819.40元。【工商银行】
 */
const ICBC_RE =
	/^尾号(?<card>\d{4})卡(?<month>\d{1,2})月(?<day>\d{1,2})日(?<hour>\d{1,2}):(?<minute>\d{2})(?<prefix>[^()]*?)(?<direction>支出|收入)\((?<inner>.*?)\)(?<amount>[\d,]+(?:\.\d{1,2})?)元，余额(?<balance>[\d,]+(?:\.\d{1,2})?)元(?:，对方户名：(?<counterparty>[^，。]+))?(?:，对方账户尾号：(?<counterpartyCard>\d+))?(?:。【[^】]*】)?$/;

export function parseIcbc(
	payload: BankSmsPayload,
	rawHash: string,
	receivedAt: number,
	bank: string,
): NormalizedTx | null {
	const content = payload.content.trim();
	const match = ICBC_RE.exec(content);
	if (!match?.groups) return null;

	const g = match.groups;
	const direction = g.direction === "支出" ? "expense" : "income";
	const occurredAt = inferDate(
		receivedAt,
		Number(g.month),
		Number(g.day),
		Number(g.hour),
		Number(g.minute),
	);

	const { subtype, channel, merchant } = splitInner(g.inner);
	const finalMerchant = merchant || g.counterparty || subtype;

	return {
		source: "bank-sms",
		bank,
		cardTail: g.card,
		direction,
		subtype,
		channel,
		amount: amountFromYuan(g.amount),
		amountYuan: Number(g.amount.replace(/,/g, "")),
		currency: "CNY",
		occurredAt,
		merchant: finalMerchant || undefined,
		counterparty: g.counterparty || undefined,
		counterpartyCard: g.counterpartyCard || undefined,
		balance: g.balance ? amountFromYuan(g.balance) : undefined,
		rawHash,
		rawPreview: preview(content),
		parser: "icbc",
		confidence: "high",
	};
}
