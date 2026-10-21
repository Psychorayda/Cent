import type { Env } from "../config";
import { json, preview, sha256Hex } from "../lib";
import { checkInboxAuth, checkSmsAuth } from "./auth";
import {
	getCategories,
	getTags,
	resolveRepo,
} from "./categories";
import { classify } from "./classify";
import {
	ackInbox,
	isSeen,
	listInbox,
	markSeen,
	putDead,
	putInbox,
	putSkip,
	saveBalance,
} from "./inbox";
import { detectBankByText, normalizeFrom, parseTs } from "./normalize";
import { parseBankSms } from "./parse";
import { parsePayloadText } from "./payload";
import type { InboxItem, NormalizedTx } from "./types";

async function makeBillId(tx: NormalizedTx): Promise<string> {
	const identity = tx.serialNo
		? `sn:${tx.serialNo}`
		: [
				tx.cardTail ?? "",
				tx.occurredAt,
				tx.amount,
				tx.direction,
				tx.merchant ?? "",
				tx.counterparty ?? "",
			].join("|");
	const hash = await sha256Hex(identity);
	return `bank-${hash.slice(0, 32)}`;
}

export async function handleBankSms(
	request: Request,
	env: Env,
): Promise<Response> {
	if (request.method !== "POST") {
		return json({ ok: false, error: "method-not-allowed" }, 405);
	}
	if (!checkSmsAuth(request, env)) {
		return json({ ok: false, error: "unauthorized" }, 401);
	}

	const body = await request.text();
	if (!body || body.length > 8192) {
		return json({ ok: false, error: "body-too-large" }, 413);
	}

	const parsed = parsePayloadText(body);
	if (!parsed.ok) {
		return json({ ok: false, error: parsed.reason }, 400);
	}

	const payload = parsed.payload;
	const dryRun =
		new URL(request.url).searchParams.get("dryRun") === "1";

	const fromInfo = normalizeFrom(payload.from);
	const tsInfo = parseTs(payload.ts);
	const bank =
		fromInfo.bank ?? detectBankByText(payload.content) ?? undefined;
	const rawHash = await sha256Hex(
		`${payload.from}\n${payload.content}`,
	);

	const repo = await resolveRepo(env);
	const bookId = repo || "unassigned";
	const categories = await getCategories(env, repo);
	const tags = await getTags(env, repo);

	const outcome = parseBankSms(
		payload,
		rawHash,
		tsInfo.ms,
		bank,
	);

	if (!outcome.ok) {
		if (!dryRun) {
			await putDead(env, rawHash, {
				from: payload.from,
				ts: payload.ts,
				tsType: tsInfo.type,
				bank,
				reason: outcome.reason,
				contentPreview: preview(payload.content),
			});
		}
		return json({
			ok: false,
			ignored: true,
			dryRun,
			reason: outcome.reason,
			normalized: {
				from: fromInfo.raw,
				fromType: fromInfo.fromType,
				bank,
				tsType: tsInfo.type,
			},
		});
	}

	const tx = outcome.tx;
	const billId = await makeBillId(tx);
	const classification = await classify(tx, categories, tags, env);

	if (dryRun) {
		return json({
			ok: true,
			dryRun: true,
			input: {
				from: payload.from,
				ts: payload.ts,
				tsType: tsInfo.type,
				contentPreview: preview(payload.content),
			},
			normalized: {
				from: fromInfo.raw,
				fromType: fromInfo.fromType,
				bank: tx.bank,
				cardTail: tx.cardTail,
				direction: tx.direction,
				amount: tx.amount,
				amountYuan: tx.amountYuan,
				balance: tx.balance,
				occurredAt: tx.occurredAt,
				merchant: tx.merchant,
				subtype: tx.subtype,
				channel: tx.channel,
				counterparty: tx.counterparty,
				counterpartyCard: tx.counterpartyCard,
				parser: tx.parser,
				confidence: tx.confidence,
			},
			classification,
			billId,
			repo: bookId,
		});
	}

	if (await isSeen(env, billId)) {
		return json({ ok: true, duplicate: true, billId });
	}

	// 即使这笔账被跳过，也要记录卡的最新余额
	if (tx.balance !== undefined && tx.cardTail) {
		await saveBalance(
			env,
			bookId,
			tx.bank,
			tx.cardTail,
			tx.balance,
			tx.occurredAt,
		);
	}

	if (classification.action === "skip") {
		await markSeen(env, billId);
		await putSkip(env, billId, tx, classification.reason ?? "skipped");
		return json({
			ok: true,
			skipped: true,
			reason: classification.reason,
			billId,
		});
	}

	const item: InboxItem = {
		id: billId,
		bookId,
		bill: {
			type: tx.direction,
			categoryId: classification.categoryId!,
			amount: tx.amount,
			time: tx.occurredAt,
			comment: classification.comment,
			tagIds: classification.tagIds?.filter(Boolean),
		},
		meta: {
			bank: tx.bank,
			cardTail: tx.cardTail,
			subtype: tx.subtype,
			channel: tx.channel,
			parser: tx.parser,
			confidence: classification.confidence,
			balance: tx.balance,
			occurredAt: tx.occurredAt,
			llm: classification.llm,
		},
		createdAt: Date.now(),
	};

	await putInbox(env, bookId, item);
	await markSeen(env, billId);

	return json({
		ok: true,
		billId,
		categoryId: classification.categoryId,
		confidence: classification.confidence,
		repo: bookId,
	});
}

export async function handleInbox(
	request: Request,
	env: Env,
): Promise<Response> {
	if (request.method !== "GET") {
		return json({ ok: false, error: "method-not-allowed" }, 405);
	}
	if (!(await checkInboxAuth(request, env))) {
		return json({ ok: false, error: "unauthorized" }, 401);
	}

	const url = new URL(request.url);
	const bookId = url.searchParams.get("book")?.trim();
	if (!bookId) {
		return json({ ok: false, error: "missing-book" }, 400);
	}

	const items = await listInbox(env, bookId);
	return json({ ok: true, items });
}

export async function handleAck(
	request: Request,
	env: Env,
): Promise<Response> {
	if (request.method !== "POST") {
		return json({ ok: false, error: "method-not-allowed" }, 405);
	}
	if (!(await checkInboxAuth(request, env))) {
		return json({ ok: false, error: "unauthorized" }, 401);
	}

	let data: any;
	try {
		data = await request.json();
	} catch {
		return json({ ok: false, error: "invalid-json" }, 400);
	}

	const bookId = String(data?.bookId ?? "").trim();
	const ids = Array.isArray(data?.ids)
		? data.ids.map((id: unknown) => String(id))
		: [];

	if (!bookId || ids.length === 0) {
		return json({ ok: false, error: "invalid-params" }, 400);
	}

	await ackInbox(env, bookId, ids);
	return json({ ok: true, acked: ids.length });
}

export function handleHealth(): Response {
	return json({
		ok: true,
		service: "cent",
		time: Date.now(),
	});
}
