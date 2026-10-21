import type { Bill } from "@/ledger/type";

export type BankInboxBill = Omit<Bill, "id" | "creatorId">;

export type BankInboxItem = {
    id: string;
    bookId: string;
    bill: BankInboxBill;
    meta: {
        bank?: string;
        cardTail?: string;
        subtype?: string;
        channel?: string;
        parser: string;
        confidence: "high" | "medium" | "low";
        balance?: number;
        occurredAt: number;
    };
    createdAt: number;
};

const GITHUB_TOKEN_KEY = "github_user_token";

export function isGithubEndpoint(): boolean {
    return (localStorage.getItem("SYNC_ENDPOINT") ?? "github") === "github";
}

export function getGithubAccessToken(): string | undefined {
    try {
        const raw = localStorage.getItem(GITHUB_TOKEN_KEY);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw);
        return typeof parsed?.accessToken === "string"
            ? parsed.accessToken
            : undefined;
    } catch {
        return undefined;
    }
}

export function hasGithubToken(): boolean {
    return Boolean(getGithubAccessToken());
}

async function request(path: string, init?: RequestInit): Promise<any> {
    const token = getGithubAccessToken();
    if (!token) {
        throw new Error("no-github-token");
    }

    const res = await fetch(path, {
        ...init,
        headers: {
            ...init?.headers,
            Authorization: `Bearer ${token}`,
        },
    });

    if (!res.ok) {
        throw new Error(`bank-inbox-${res.status}`);
    }
    return res.json();
}

export async function fetchBankInbox(bookId: string): Promise<BankInboxItem[]> {
    const data = await request(`/api/inbox?book=${encodeURIComponent(bookId)}`);
    return Array.isArray(data?.items) ? data.items : [];
}

export async function ackBankInbox(
    bookId: string,
    ids: string[],
): Promise<void> {
    if (ids.length === 0) return;
    await request("/api/inbox/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, ids }),
    });
}
