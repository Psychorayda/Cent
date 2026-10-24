import { createContext, useContext } from "react";
import { useIntl } from "@/locale";
import { Button } from "../ui/button";
import KeyboardForm from "./keyboard-form";

export type VoiceFormPhase = "listening" | "parsing" | "error" | "keyboard";

export type VoiceFormState = {
    text: string;
    phase: VoiceFormPhase;
    /** 错误提示对应的国际化 key */
    error?: string;
    /** 原始错误信息，用于未知错误的兜底展示 */
    errorDetail?: string;
};

export type VoiceFormContextValue = {
    state: VoiceFormState;
    retry: () => void;
    openTextInput: () => void;
};

export const VoiceFormContext = createContext<VoiceFormContextValue | null>(
    null,
);

export default function VoiceForm({ onCancel }: { onCancel?: () => void }) {
    const t = useIntl();
    const context = useContext(VoiceFormContext);
    if (!context) {
        console.warn("VoiceForm need be child of VoiceFormContext");
    }
    const state = context?.state;
    const text = state?.text;
    const phase = state?.phase ?? "listening";
    // 环境性错误重试也不会成功，直接引导到文本输入
    const canRetry = ![
        "voice-error-unsupported",
        "voice-error-service-not-allowed",
        "voice-error-insecure",
    ].includes(state?.error ?? "");

    if (phase === "keyboard") {
        return (
            <KeyboardForm
                onCancel={onCancel}
                onConfirm={() => {
                    // 账单已写入成功，关闭当前弹窗即可
                    onCancel?.();
                }}
            />
        );
    }

    return (
        <div>
            <div className="min-h-[320px] flex flex-col w-full h-full bg-background text-foreground items-center justify-center relative">
                <div className="w-full flex justify-end items-center">
                    <Button variant={"ghost"} onClick={onCancel}>
                        <i className="icon-[mdi--close]"></i>
                    </Button>
                </div>
                {/* 麦克风/思考/错误图标和动画 */}
                <div className="relative flex flex-col items-center justify-center mt-14 mb-8">
                    {phase === "listening" ? (
                        <>
                            {/* 外层扩散动画 */}
                            <div
                                className="absolute w-32 h-32 rounded-full bg-primary/20 animate-ping"
                                style={{ animationDuration: "2s" }}
                            />
                            {/* 内层扩散动画 */}
                            <div
                                className="absolute w-24 h-24 rounded-full bg-primary/30 animate-ping"
                                style={{ animationDuration: "1.5s" }}
                            />
                            {/* 麦克风图标背景 */}
                            <div className="relative w-20 h-20 rounded-full bg-primary flex items-center justify-center shadow-lg">
                                <i className="icon-[mdi--microphone] text-white size-10" />
                            </div>
                        </>
                    ) : phase === "parsing" ? (
                        <>
                            {/* 思考图标 - 抖动动画 */}
                            <div className="relative w-20 h-20 rounded-full flex items-center justify-center animate-wiggle">
                                <i className="icon-[mdi--brain] size-10" />
                            </div>
                            {/* 上下跳动的圆点 */}
                            <div className="flex gap-2 mt-2">
                                <div
                                    className="w-1 h-1 rounded-full bg-primary animate-bounce"
                                    style={{
                                        animationDelay: "0ms",
                                        animationDuration: "0.5s",
                                    }}
                                />
                                <div
                                    className="w-1 h-1 rounded-full bg-primary animate-bounce"
                                    style={{
                                        animationDelay: "200ms",
                                        animationDuration: "0.5s",
                                    }}
                                />
                                <div
                                    className="w-1 h-1 rounded-full bg-primary animate-bounce"
                                    style={{
                                        animationDelay: "400ms",
                                        animationDuration: "0.5s",
                                    }}
                                />
                            </div>
                        </>
                    ) : (
                        <div className="relative w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center">
                            <i className="icon-[mdi--microphone-off] text-red-500 size-10" />
                        </div>
                    )}
                </div>

                {/* 识别文本 / 错误提示 */}
                <div className="text-center mb-auto px-4 max-w-md">
                    {phase === "listening" ? (
                        <p
                            data-voice-text
                            className="text-lg text-foreground/80"
                        >
                            {!text ? t("voice-listening-text") : text}
                        </p>
                    ) : phase === "parsing" ? (
                        <p
                            data-voice-text
                            className="text-lg text-foreground/80"
                        >
                            {t("voice-parsing-text")}
                        </p>
                    ) : (
                        <p className="text-base text-foreground/80 whitespace-pre-wrap">
                            {t(state?.error ?? "voice-error-unknown", {
                                error: state?.errorDetail ?? "",
                            })}
                        </p>
                    )}
                </div>

                {/* 失败时提供重试与文本输入兜底 */}
                {phase === "error" ? (
                    <>
                        <div className="w-full flex gap-2 px-4">
                            {canRetry && (
                                <Button
                                    className="flex-1"
                                    onClick={() => context?.retry()}
                                >
                                    <i className="icon-[mdi--refresh] mr-1"></i>
                                    {t("voice-retry")}
                                </Button>
                            )}
                            <Button
                                variant={canRetry ? "outline" : "default"}
                                className="flex-1"
                                onClick={() => context?.openTextInput()}
                            >
                                <i className="icon-[mdi--keyboard-outline] mr-1"></i>
                                {t("voice-use-keyboard")}
                            </Button>
                        </div>
                        <div className="text-center text-xs text-foreground/60 mt-4 p-4">
                            {t("voice-error-fallback-tip")}
                        </div>
                    </>
                ) : (
                    phase === "listening" && (
                        <div className="text-center text-sm text-foreground/60 mt-4 p-4">
                            {t("voice-cancel-tip")}
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
