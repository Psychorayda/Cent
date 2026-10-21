import { useEffect } from "react";
import { toast } from "sonner";
import {
    ackBankInbox,
    fetchBankInbox,
    hasGithubToken,
    isGithubEndpoint,
} from "@/api/bank-inbox";
import { measure } from "@/measurement";
import { useBookStore } from "@/store/book";
import { useLedgerStore } from "@/store/ledger";

const REFUND_CATEGORY = {
    id: "refund",
    type: "income" as const,
    name: "退款",
    icon: "icon-[mdi--cash-refund]",
    color: "#2e8b57",
    customName: true,
};

const BANK_TAGS = [
    { id: "bank-refund", name: "退款" },
    { id: "bank-transfer-pending", name: "转账待确认" },
    { id: "bank-credit-card-repayment", name: "信用卡还款" },
];

const PROCESSED_KEY = "bank-inbox-processed";

function readProcessed(): string[] {
    try {
        const value = JSON.parse(localStorage.getItem(PROCESSED_KEY) ?? "[]");
        return Array.isArray(value)
            ? value.filter((id) => typeof id === "string")
            : [];
    } catch {
        return [];
    }
}

function markProcessed(ids: string[]) {
    const merged = new Set([...readProcessed(), ...ids]);
    localStorage.setItem(
        PROCESSED_KEY,
        JSON.stringify([...merged].slice(-500)),
    );
}

async function ensureBankMeta() {
    const store = useLedgerStore.getState();
    const meta = store.infos?.meta;
    if (!meta) return;

    const categories = meta.categories ?? [];
    const tags = meta.tags ?? [];

    const hasRefundCategory = categories.some(
        (c) =>
            c.id === REFUND_CATEGORY.id ||
            (c.type === "income" && c.name === REFUND_CATEGORY.name),
    );
    const missingTags = BANK_TAGS.filter(
        (tag) =>
            !tags.some((item) => item.id === tag.id || item.name === tag.name),
    );

    if (hasRefundCategory && missingTags.length === 0) return;

    await store.updateGlobalMeta((prev) => ({
        ...prev,
        categories: hasRefundCategory
            ? (prev.categories ?? [])
            : [...(prev.categories ?? []), { ...REFUND_CATEGORY }],
        tags: [...(prev.tags ?? []), ...missingTags],
    }));

    // 等本地 infos 刷新，避免刚导入的退款账单短暂显示空分类
    if (hasRefundCategory) return;
    for (let i = 0; i < 6; i += 1) {
        const current = useLedgerStore.getState().infos?.meta.categories ?? [];
        const present = current.some(
            (c) =>
                c.id === REFUND_CATEGORY.id ||
                (c.type === "income" && c.name === REFUND_CATEGORY.name),
        );
        if (present) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
}

async function pullInbox(bookId: string) {
    if (!isGithubEndpoint() || !hasGithubToken()) return;

    const [assigned, unassigned] = await Promise.all([
        fetchBankInbox(bookId),
        bookId === "unassigned"
            ? Promise.resolve([])
            : fetchBankInbox("unassigned").catch(() => []),
    ]);

    const byId = new Map(
        [...assigned, ...unassigned].map((item) => [item.id, item]),
    );
    const processed = new Set(readProcessed());
    const fresh = [...byId.values()].filter((item) => !processed.has(item.id));
    if (fresh.length === 0) return;

    await ensureBankMeta();

    await useLedgerStore.getState().updateBills(
        fresh.map((item) => ({
            id: item.id,
            entry: item.bill,
        })),
    );

    markProcessed(fresh.map((item) => item.id));

    const groups = new Map<string, string[]>();
    for (const item of fresh) {
        const list = groups.get(item.bookId) ?? [];
        list.push(item.id);
        groups.set(item.bookId, list);
    }
    await Promise.all(
        [...groups.entries()].map(([targetBook, ids]) =>
            ackBankInbox(targetBook, ids),
        ),
    );

    toast.success(`已自动导入 ${fresh.length} 笔银行账单`);
    measure("bill_created", {
        source: "bank_sms",
        item_count: fresh.length,
    });
}

export function useBankInbox() {
    const bookId = useBookStore((state) => state.currentBookId);
    const ready = useLedgerStore(
        (state) => !state.loading && Boolean(state.infos),
    );

    useEffect(() => {
        if (!bookId || !ready) return;

        let cancelled = false;
        let lastRun = 0;

        const run = () => {
            if (cancelled) return;
            const now = Date.now();
            if (now - lastRun < 60_000) return;
            lastRun = now;
            pullInbox(bookId).catch((error) => {
                const message = String((error as Error)?.message ?? error);
                if (message.includes("no-github-token")) return;
                console.warn("[bank-inbox]", error);
            });
        };

        run();

        const onVisible = () => {
            if (document.visibilityState === "visible") run();
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", run);

        return () => {
            cancelled = true;
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("focus", run);
        };
    }, [bookId, ready]);
}
