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
        llm?: {
            model?: string;
            confidence?: number;
            reason?: string;
        };
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

export async function fetchBankInbox(
    bookId?: string,
): Promise<BankInboxItem[]> {
    const qs = bookId ? `?book=${encodeURIComponent(bookId)}` : "";
    const data = await request(`/api/inbox${qs}`);
    return Array.isArray(data?.items) ? data.items : [];
}

export async function ackBankInbox(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await request("/api/inbox/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
    });
}

export type CentTokenInfo = {
    token: string;
    uid: string;
    login: string;
};

function readTokenInfo(data: any): CentTokenInfo {
    if (typeof data?.token !== "string") {
        throw new Error("invalid-token-response");
    }
    return {
        token: data.token,
        uid: String(data.uid ?? ""),
        login: String(data.login ?? ""),
    };
}

/** 用当前登录的 GitHub token 换取固定的短信 token */
export async function fetchCentToken(): Promise<CentTokenInfo> {
    return readTokenInfo(await request("/api/token", { method: "POST" }));
}

/** 作废旧 token 并换取新的 */
export async function resetCentToken(): Promise<CentTokenInfo> {
    return readTokenInfo(await request("/api/token/reset", { method: "POST" }));
}

export async function fetchDefaultBook(): Promise<string | null> {
    const data = await request("/api/default-book");
    return typeof data?.defaultBook === "string" ? data.defaultBook : null;
}

export async function saveDefaultBook(bookId: string | null): Promise<void> {
    await request("/api/default-book", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultBook: bookId }),
    });
}

/** 默认账本被删除 / 失去权限时自动清空配置 */
export async function reconcileDefaultBook(bookIds: string[]): Promise<void> {
    if (!isGithubEndpoint() || !hasGithubToken()) return;

    const current = await fetchDefaultBook();
    if (current && !bookIds.includes(current)) {
        await saveDefaultBook(null);
    }
}
