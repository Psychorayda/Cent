import type { Env } from "../config";
import type { InboxItem, NormalizedTx } from "./types";

const TTL_30_DAYS = 30 * 24 * 60 * 60;

export async function isSeen(
    env: Env,
    uid: string,
    billId: string,
): Promise<boolean> {
    return Boolean(await env.INBOX_KV.get(`seen:${uid}:${billId}`));
}

export async function markSeen(
    env: Env,
    uid: string,
    billId: string,
): Promise<void> {
    await env.INBOX_KV.put(`seen:${uid}:${billId}`, "1", {
        expirationTtl: TTL_30_DAYS,
    });
}

export async function putInbox(
    env: Env,
    uid: string,
    item: InboxItem,
): Promise<void> {
    await env.INBOX_KV.put(`inbox:${uid}:${item.id}`, JSON.stringify(item), {
        expirationTtl: TTL_30_DAYS,
    });
}

export async function listInbox(
    env: Env,
    uid: string,
    limit = 100,
): Promise<InboxItem[]> {
    const prefix = `inbox:${uid}:`;
    const listed = await env.INBOX_KV.list({ prefix, limit });
    const items = await Promise.all(
        listed.keys.map(async (key: { name: string }) => {
            const value = await env.INBOX_KV.get(key.name, "json");
            return value as InboxItem | null;
        }),
    );
    return items
        .filter((item): item is InboxItem => Boolean(item?.id))
        .sort((a, b) => a.createdAt - b.createdAt);
}

export async function ackInbox(
    env: Env,
    uid: string,
    ids: string[],
): Promise<void> {
    await Promise.all(
        ids.map((id) => env.INBOX_KV.delete(`inbox:${uid}:${id}`)),
    );
}

export async function saveBalance(
    env: Env,
    uid: string,
    bank: string | undefined,
    cardTail: string,
    balance: number,
    occurredAt: number,
): Promise<void> {
    const key = `balance:${uid}:${bank ?? "unknown"}:${cardTail}`;
    const previous: any = await env.INBOX_KV.get(key, "json");
    if (previous?.occurredAt && previous.occurredAt > occurredAt) {
        return;
    }
    await env.INBOX_KV.put(
        key,
        JSON.stringify({
            balance,
            occurredAt,
            updatedAt: Date.now(),
        }),
    );
}

export async function putDead(
    env: Env,
    uid: string,
    hash: string,
    data: Record<string, unknown>,
): Promise<void> {
    await env.INBOX_KV.put(
        `dead:${uid}:${hash}`,
        JSON.stringify({ ...data, createdAt: Date.now() }),
        { expirationTtl: TTL_30_DAYS },
    );
}

export async function putSkip(
    env: Env,
    uid: string,
    billId: string,
    tx: NormalizedTx,
    reason: string,
): Promise<void> {
    await env.INBOX_KV.put(
        `skip:${uid}:${billId}`,
        JSON.stringify({
            reason,
            bank: tx.bank,
            cardTail: tx.cardTail,
            amount: tx.amount,
            direction: tx.direction,
            merchant: tx.merchant,
            occurredAt: tx.occurredAt,
            createdAt: Date.now(),
        }),
        { expirationTtl: TTL_30_DAYS },
    );
}
