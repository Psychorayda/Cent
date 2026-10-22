import type { Env } from "../config";
import { json, preview, sha256Hex } from "../lib";
import { getGithubIdentity, resolveSmsUser } from "./auth";
import { getCategories, getTags } from "./categories";
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
import { allowRequest, clientIp } from "./ratelimit";
import { getDefaultBook } from "./settings";
import { issueToken, resetToken } from "./token";
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

async function tokenResponse(
    request: Request,
    env: Env,
    mint: (uid: string) => Promise<string>,
): Promise<Response> {
    if (request.method !== "POST") {
        return json({ ok: false, error: "method-not-allowed" }, 405);
    }

    if (
        !(await allowRequest(env.TOKEN_RATE_LIMITER, `ip:${clientIp(request)}`))
    ) {
        return json({ ok: false, error: "rate-limited" }, 429);
    }

    const identity = await getGithubIdentity(request, env);
    if (!identity) {
        return json({ ok: false, error: "unauthorized" }, 401);
    }

    try {
        return json({
            ok: true,
            uid: identity.id,
            login: identity.login,
            token: await mint(identity.id),
        });
    } catch {
        return json({ ok: false, error: "token-unavailable" }, 503);
    }
}

/** POST /api/token：用 GitHub token 换取绑定 uid 的长期 token */
export function handleToken(request: Request, env: Env): Promise<Response> {
    return tokenResponse(request, env, (uid) => issueToken(env, uid));
}

/** POST /api/token/reset：作废旧 token 并返回新的 */
export function handleResetToken(
    request: Request,
    env: Env,
): Promise<Response> {
    return tokenResponse(request, env, (uid) => resetToken(env, uid));
}

export async function handleBankSms(
    request: Request,
    env: Env,
): Promise<Response> {
    if (request.method !== "POST") {
        return json({ ok: false, error: "method-not-allowed" }, 405);
    }

    const uid = await resolveSmsUser(request, env);
    if (!uid) {
        return json({ ok: false, error: "unauthorized" }, 401);
    }

    if (!(await allowRequest(env.SMS_RATE_LIMITER, uid))) {
        return json({ ok: false, error: "rate-limited" }, 429);
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
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

    const fromInfo = normalizeFrom(payload.from);
    const tsInfo = parseTs(payload.ts);
    const bank =
        fromInfo.bank ?? detectBankByText(payload.content) ?? undefined;
    const rawHash = await sha256Hex(`${payload.from}\n${payload.content}`);

    // 短信在到达时就绑定到用户的默认账本，避免导入时随当前打开的账本漂移
    const defaultBook = await getDefaultBook(env, uid);
    const bookId = defaultBook ?? "unassigned";

    // 分类配置只读用户自己的默认账本；未设置时使用内置默认分类
    const metaRepo = defaultBook ?? "";
    const categories = await getCategories(env, metaRepo);
    const tags = await getTags(env, metaRepo);

    const outcome = parseBankSms(payload, rawHash, tsInfo.ms, bank);

    if (!outcome.ok) {
        if (!dryRun) {
            await putDead(env, uid, rawHash, {
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
    const classification = await classify(tx, categories, tags, env, uid);

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

    if (await isSeen(env, uid, billId)) {
        return json({ ok: true, duplicate: true, billId });
    }

    // 即使这笔账被跳过，也要记录卡的最新余额
    if (tx.balance !== undefined && tx.cardTail) {
        await saveBalance(
            env,
            uid,
            tx.bank,
            tx.cardTail,
            tx.balance,
            tx.occurredAt,
        );
    }

    if (classification.action === "skip") {
        await markSeen(env, uid, billId);
        await putSkip(env, uid, billId, tx, classification.reason ?? "skipped");
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

    await putInbox(env, uid, item);
    await markSeen(env, uid, billId);

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
    const identity = await getGithubIdentity(request, env);
    if (!identity) {
        return json({ ok: false, error: "unauthorized" }, 401);
    }

    const book = new URL(request.url).searchParams.get("book")?.trim() ?? "";
    const defaultBook = await getDefaultBook(env, identity.id);
    const all = await listInbox(env, identity.id);

    const items = !book
        ? all
        : all.filter(
              (item) =>
                  item.bookId === book ||
                  // 早期未绑定账本的历史短信，只在默认账本下被领取
                  (item.bookId === "unassigned" && book === defaultBook),
          );

    return json({ ok: true, items });
}

export async function handleAck(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
        return json({ ok: false, error: "method-not-allowed" }, 405);
    }
    const identity = await getGithubIdentity(request, env);
    if (!identity) {
        return json({ ok: false, error: "unauthorized" }, 401);
    }

    let data: any;
    try {
        data = await request.json();
    } catch {
        return json({ ok: false, error: "invalid-json" }, 400);
    }

    const ids = Array.isArray(data?.ids)
        ? data.ids.map((id: unknown) => String(id))
        : [];

    if (ids.length === 0) {
        return json({ ok: false, error: "invalid-params" }, 400);
    }

    await ackInbox(env, identity.id, ids);
    return json({ ok: true, acked: ids.length });
}

export function handleHealth(): Response {
    return json({
        ok: true,
        service: "cent",
        time: Date.now(),
    });
}
