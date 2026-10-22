import { useEffect } from "react";
import { toast } from "sonner";
import {
    ackBankInbox,
    fetchBankInbox,
    hasGithubToken,
    isGithubEndpoint,
} from "@/api/bank-inbox";
import { BillCategories } from "@/ledger/category";
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

    const effectiveCategories =
        meta.categories && meta.categories.length > 0
            ? meta.categories
            : BillCategories;
    const tags = meta.tags ?? [];

    const hasRefundCategory = effectiveCategories.some(
        (c) =>
            c.id === REFUND_CATEGORY.id ||
            (c.type === "income" && c.name === REFUND_CATEGORY.name),
    );
    const missingTags = BANK_TAGS.filter(
        (tag) =>
            !tags.some((item) => item.id === tag.id || item.name === tag.name),
    );

    if (hasRefundCategory && missingTags.length === 0) return;

    await store.updateGlobalMeta((prev) => {
        const customCategories =
            prev.categories && prev.categories.length > 0
                ? prev.categories
                : undefined;

        const currentCategories = customCategories ?? BillCategories;
        const hasRefund = currentCategories.some(
            (c) =>
                c.id === REFUND_CATEGORY.id ||
                (c.type === "income" && c.name === REFUND_CATEGORY.name),
        );

        const nextTags = [...(prev.tags ?? [])];
        for (const tag of BANK_TAGS) {
            if (
                !nextTags.some(
                    (item) => item.id === tag.id || item.name === tag.name,
                )
            ) {
                nextTags.push(tag);
            }
        }

        return {
            ...prev,
            // 没有自定义分类时保持 undefined，让 useCategory 回退到默认分类
            categories: customCategories
                ? hasRefund
                    ? customCategories
                    : [...customCategories, { ...REFUND_CATEGORY }]
                : undefined,
            tags: nextTags,
        };
    });

    // 等本地 infos 刷新，避免刚导入的退款账单短暂显示空分类
    if (hasRefundCategory) return;
    for (let i = 0; i < 6; i += 1) {
        const current = useLedgerStore.getState().infos?.meta.categories;
        const effective = current?.length ? current : BillCategories;
        const present = effective.some(
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

    // 服务端已按 uid + 当前账本过滤，未绑定该账本的短信不会返回
    const items = await fetchBankInbox(bookId);
    if (items.length === 0) return;

    const processed = new Set(readProcessed());
    const fresh = items.filter((item) => !processed.has(item.id));

    if (fresh.length === 0) {
        await ackBankInbox(items.map((item) => item.id));
        return;
    }

    await ensureBankMeta();

    await useLedgerStore.getState().updateBills(
        fresh.map((item) => ({
            id: item.id,
            entry: item.bill,
        })),
    );

    markProcessed(fresh.map((item) => item.id));

    await ackBankInbox(items.map((item) => item.id));

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
        const interval = window.setInterval(() => {
            if (document.visibilityState === "visible") run();
        }, 5 * 60_000);

        return () => {
            cancelled = true;
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("focus", run);
            window.clearInterval(interval);
        };
    }, [bookId, ready]);
}
