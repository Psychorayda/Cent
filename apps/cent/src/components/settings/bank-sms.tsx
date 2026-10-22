import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
    type CentTokenInfo,
    fetchCentToken,
    fetchDefaultBook,
    resetCentToken,
    saveDefaultBook,
} from "@/api/bank-inbox";
import { requestBankInboxRefresh } from "@/hooks/use-bank-inbox";
import { useIntl } from "@/locale";
import { useBookStore } from "@/store/book";
import modal from "../modal";
import { Button } from "../ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../ui/select";

const NONE = "__none__";

const SMS_TEMPLATE =
    '{"from":"{{FROM}}","content":"{{SMS}}","ts":"{{RECEIVE_TIME}}"}';

type TokenError = "auth" | "config" | "network" | null;

function maskToken(token: string) {
    if (token.length <= 18) return token;
    return `${token.slice(0, 10)}…${token.slice(-6)}`;
}

function DefaultBookItem() {
    const t = useIntl();
    const books = useBookStore((s) => s.books);
    const currentBookId = useBookStore((s) => s.currentBookId);
    const [value, setValue] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const clearedRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        fetchDefaultBook()
            .then((v) => {
                if (!cancelled) setValue(v);
            })
            .catch(() => {})
            .finally(() => {
                if (!cancelled) setLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const invalid =
        Boolean(value) &&
        books.length > 0 &&
        !books.some((b) => b.id === value);

    // 账本被删除 / 失去协作者权限时自动清空默认值
    useEffect(() => {
        if (!loaded || !invalid || clearedRef.current) return;
        clearedRef.current = true;
        saveDefaultBook(null)
            .then(() => {
                setValue(null);
                toast.error(t("default-book-cleared"));
            })
            .catch(() => {
                clearedRef.current = false;
            });
    }, [loaded, invalid, t]);

    const onChange = async (next: string) => {
        const bookId = next === NONE ? null : next;
        const prev = value;
        setValue(bookId);
        try {
            await saveDefaultBook(bookId);
            toast.success(t("saved"));
            // 默认账本变化会影响待处理短信的归属，立即重新拉取
            requestBankInboxRefresh();
        } catch {
            setValue(prev);
            toast.error(t("save-failed"));
        }
    };

    return (
        <div className="w-full px-4 py-1 text-sm">
            <div className="w-full px-4 flex justify-between items-center gap-3 font-medium">
                <div className="flex items-center gap-2">
                    <i className="icon-[mdi--book-open-page-variant] size-5"></i>
                    {t("default-book")}
                </div>
                {loaded ? (
                    <Select value={value ?? NONE} onValueChange={onChange}>
                        <SelectTrigger className="w-[180px] text-xs rounded-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NONE}>
                                {t("default-book-unset")}
                            </SelectItem>
                            {invalid && value && (
                                <SelectItem value={value} disabled>
                                    {value}
                                </SelectItem>
                            )}
                            {books.map((book) => (
                                <SelectItem key={book.id} value={book.id}>
                                    {book.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : (
                    <span className="text-xs opacity-60">{t("loading")}</span>
                )}
            </div>
            <div className="px-4 pt-1 pl-7 text-xs opacity-60">
                {invalid ? t("default-book-invalid") : t("default-book-hint")}
            </div>
            {!value && (
                <div className="px-4 pt-1 pl-7 text-xs text-amber-600">
                    {t("default-book-unset-hint")}
                </div>
            )}
            {value && value !== currentBookId && (
                <div className="px-4 pt-1 pl-7 text-xs opacity-60">
                    {t("default-book-not-current")}
                </div>
            )}
        </div>
    );
}

function SmsTokenItem() {
    const t = useIntl();
    const [info, setInfo] = useState<CentTokenInfo | null>(null);
    const [failed, setFailed] = useState<TokenError>(null);
    const [visible, setVisible] = useState(false);
    const [resetting, setResetting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetchCentToken()
            .then((v) => {
                if (!cancelled) setInfo(v);
            })
            .catch((error) => {
                if (cancelled) return;
                const message = String((error as Error)?.message ?? "");
                if (message.includes("503")) {
                    setFailed("config");
                } else if (message.includes("401")) {
                    setFailed("auth");
                } else {
                    setFailed("network");
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const endpoint = `${location.origin}/api/bank-sms`;

    const copy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success(t("copied"));
        } catch {
            toast.error(t("copy-failed"));
        }
    };

    const toReset = async () => {
        try {
            await modal.prompt({ title: t("bank-sms-reset-confirm") });
        } catch {
            return;
        }

        setResetting(true);
        try {
            const next = await resetCentToken();
            setInfo(next);
            toast.success(t("bank-sms-reset-success"));
        } catch {
            toast.error(t("save-failed"));
        } finally {
            setResetting(false);
        }
    };

    return (
        <div className="w-full px-4 py-1 text-sm">
            <div className="w-full px-4 flex justify-between items-center gap-3 font-medium">
                <div className="flex items-center gap-2">
                    <i className="icon-[mdi--message-text-outline] size-5"></i>
                    {t("bank-sms-token")}
                </div>
                {info && (
                    <span className="text-xs opacity-60">@{info.login}</span>
                )}
            </div>
            {failed ? (
                <div className="px-4 pt-1 pl-7 text-xs text-amber-600">
                    {failed === "config"
                        ? t("bank-sms-unavailable-config")
                        : failed === "auth"
                          ? t("bank-sms-unavailable")
                          : t("bank-sms-network")}
                </div>
            ) : info ? (
                <div className="px-4 pt-2 pl-7 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <span className="text-xs opacity-60 w-16 shrink-0">
                            {t("bank-sms-endpoint")}
                        </span>
                        <code className="text-xs flex-1 min-w-0 truncate">
                            {endpoint}
                        </code>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copy(endpoint)}
                        >
                            {t("copy")}
                        </Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs opacity-60 w-16 shrink-0">
                            {t("bank-sms-header")}
                        </span>
                        <code className="text-xs flex-1 min-w-0 truncate">
                            X-Cent-Token
                        </code>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copy("X-Cent-Token")}
                        >
                            {t("copy")}
                        </Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs opacity-60 w-16 shrink-0">
                            {t("bank-sms-token-label")}
                        </span>
                        <code className="text-xs flex-1 min-w-0 truncate">
                            {visible ? info.token : maskToken(info.token)}
                        </code>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setVisible((v) => !v)}
                        >
                            {visible ? t("hide") : t("show")}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copy(info.token)}
                        >
                            {t("copy")}
                        </Button>
                    </div>
                    <div className="flex items-start gap-2">
                        <span className="text-xs opacity-60 w-16 shrink-0">
                            {t("bank-sms-template")}
                        </span>
                        <code className="text-[10px] flex-1 min-w-0 break-all opacity-70">
                            {SMS_TEMPLATE}
                        </code>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copy(SMS_TEMPLATE)}
                        >
                            {t("copy")}
                        </Button>
                    </div>
                    <div className="text-xs opacity-60">
                        {t("bank-sms-hint")}
                    </div>
                    <div className="flex justify-end">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={resetting}
                            onClick={toReset}
                        >
                            {t("bank-sms-reset")}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="px-4 pt-1 pl-7 text-xs opacity-60">
                    {t("loading")}
                </div>
            )}
        </div>
    );
}

export default function BankSmsSettingsItems() {
    return (
        <>
            <DefaultBookItem />
            <SmsTokenItem />
        </>
    );
}
