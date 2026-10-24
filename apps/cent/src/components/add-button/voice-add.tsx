import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useLongPress } from "@/hooks/use-long-press";
import { t } from "@/locale";
import { measure } from "@/measurement";
import { useLedgerStore } from "@/store/ledger";
import { parseTextToBill } from "../assistant/text-to-bill";
import createConfirmProvider from "../confirm";
import { isCancelError } from "../confirm/state";
import { BaseButton } from "./base";
import { startRecognize } from "./recognize";
import VoiceForm, { VoiceFormContext, type VoiceFormState } from "./voice-form";

const [VoiceFormProvider, , showVoiceForm] = createConfirmProvider(VoiceForm, {
    dialogTitle: t("voice-recording-dialog-title"),
    dialogModalClose: false,
    fade: true,
    swipe: false,
});

const VOICE_ERROR_KEYS: Record<string, string> = {
    insecure: "voice-error-insecure",
    unsupported: "voice-error-unsupported",
    "not-allowed": "voice-error-not-allowed",
    "service-not-allowed": "voice-error-service-not-allowed",
    "audio-capture": "voice-error-audio-capture",
    network: "voice-error-network",
    "no-speech": "voice-error-no-speech",
    "recognition-aborted": "voice-error-recognition-aborted",
    "recognition-ended": "voice-error-recognition-ended",
    "start-failed": "voice-error-start-failed",
    InvalidStateError: "voice-error-start-failed",
    NotSupportedError: "voice-error-unsupported",
};

const EMPTY_FORM_STATE: VoiceFormState = {
    text: "",
    phase: "listening",
};

function parseVoiceError(error: unknown) {
    const message =
        error instanceof Error ? error.message : String(error ?? "");
    if (message === "aborted manually") {
        return { cancelled: true } as const;
    }
    const code = message === "aborted" ? "recognition-aborted" : message;
    return {
        cancelled: false,
        key: VOICE_ERROR_KEYS[code] ?? "voice-error-unknown",
        detail: message,
    } as const;
}

export function VoiceAddButton({ onClick }: { onClick?: () => void }) {
    const cancelRecognitionRef = useRef<(() => void) | undefined>(undefined);
    const stopRecognitionRef = useRef<(() => void) | undefined>(undefined);
    const closeDialogRef = useRef<(() => void) | undefined>(undefined);
    const dialogOpenRef = useRef(false);
    // 每次识别/重试/切换模式都会递增，用于丢弃过期的异步结果
    const runIdRef = useRef(0);

    const [formState, setFormState] =
        useState<VoiceFormState>(EMPTY_FORM_STATE);

    const resetDialogState = useCallback(() => {
        runIdRef.current += 1;
        dialogOpenRef.current = false;
        closeDialogRef.current = undefined;
        cancelRecognitionRef.current?.();
        cancelRecognitionRef.current = undefined;
        stopRecognitionRef.current = undefined;
        setFormState(EMPTY_FORM_STATE);
    }, []);

    const runRecognition = useCallback(async () => {
        const runId = ++runIdRef.current;

        // 中止上一次尚未结束的识别
        cancelRecognitionRef.current?.();
        cancelRecognitionRef.current = undefined;
        stopRecognitionRef.current = undefined;

        setFormState(EMPTY_FORM_STATE);

        const {
            finished,
            cancel: cancelRecognizing,
            stop: stopRecognizing,
        } = startRecognize((text) => {
            if (runIdRef.current !== runId) return;
            setFormState((prev) =>
                prev.phase === "listening" ? { ...prev, text } : prev,
            );
        });

        cancelRecognitionRef.current = cancelRecognizing;
        stopRecognitionRef.current = stopRecognizing;

        let stage: "recognize" | "parse" = "recognize";

        try {
            const value = (await finished).trim();
            if (runIdRef.current !== runId || !dialogOpenRef.current) return;
            if (value.length === 0) {
                setFormState({
                    text: "",
                    phase: "error",
                    error: "voice-error-no-speech",
                });
                return;
            }

            stage = "parse";
            setFormState({ text: value, phase: "parsing" });
            const bills = await parseTextToBill(value);
            if (runIdRef.current !== runId || !dialogOpenRef.current) return;
            if (bills.length === 0) {
                setFormState({
                    text: value,
                    phase: "error",
                    error: "voice-error-no-bills",
                });
                return;
            }
            await useLedgerStore.getState().addBills(bills);
            measure("bill_created", {
                source: "voice",
                item_count: bills.length,
            });
            toast.success(t("voice-add-success", { count: bills.length }));
            dialogOpenRef.current = false;
            closeDialogRef.current?.();
        } catch (error) {
            console.error(error);
            if (runIdRef.current !== runId || !dialogOpenRef.current) return;
            const parsed = parseVoiceError(error);
            if (parsed.cancelled) return;
            setFormState({
                text: "",
                phase: "error",
                error:
                    stage === "parse" && parsed.key === "voice-error-unknown"
                        ? "voice-error-parse-failed"
                        : parsed.key,
                errorDetail: parsed.detail,
            });
        } finally {
            if (runIdRef.current === runId) {
                cancelRecognitionRef.current = undefined;
                stopRecognitionRef.current = undefined;
            }
        }
    }, []);

    const retry = useCallback(() => {
        if (!dialogOpenRef.current) return;
        void runRecognition();
    }, [runRecognition]);

    const openTextInput = useCallback(() => {
        // 让进行中的识别结果失效，避免回填到文本输入态
        runIdRef.current += 1;
        cancelRecognitionRef.current?.();
        cancelRecognitionRef.current = undefined;
        stopRecognitionRef.current = undefined;
        setFormState({ text: "", phase: "keyboard" });
    }, []);

    const presses = useLongPress({
        onClick,
        onLongPressStart: useCallback(() => {
            const { promise: dialogClosed, cancel: closeDialog } =
                showVoiceForm();

            dialogOpenRef.current = true;
            closeDialogRef.current = closeDialog;

            void dialogClosed.then(
                () => resetDialogState(),
                (error) => {
                    if (!isCancelError(error)) {
                        console.warn(error);
                    }
                    resetDialogState();
                },
            );

            void runRecognition();
        }, [resetDialogState, runRecognition]),
        onLongPressEnd: useCallback(() => {
            console.log("start parsing voice texts");
            stopRecognitionRef.current?.();
            stopRecognitionRef.current = undefined;
        }, []),
        onLongPressCancel: useCallback(() => {
            // 先让进行中的识别结果失效，再取消识别并关闭弹窗
            runIdRef.current += 1;
            cancelRecognitionRef.current?.();
            closeDialogRef.current?.();
        }, []),
    });

    return (
        <VoiceFormContext.Provider
            value={{ state: formState, retry, openTextInput }}
        >
            <BaseButton {...presses?.()}>
                {/* <i className="icon-[mdi--microphone-plus] text-[white] size-7"></i> */}
                <i className="icon-[mdi--add] text-[white] size-7"></i>
            </BaseButton>
            <VoiceFormProvider />
        </VoiceFormContext.Provider>
    );
}
