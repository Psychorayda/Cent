// Web Speech API 类型定义
interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
}

interface SpeechRecognitionResultList {
    length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
    length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
    isFinal: boolean;
}

interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

interface SpeechRecognitionError extends Event {
    error: string;
    message: string;
}

interface ISpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionError) => void) | null;
    onend: (() => void) | null;
}

declare global {
    interface Window {
        SpeechRecognition: new () => ISpeechRecognition;
        webkitSpeechRecognition: new () => ISpeechRecognition;
    }
}

let currentRecognition: ISpeechRecognition | null = null;

export function isSpeechRecognitionSupported() {
    if (window.isSecureContext === false) {
        return false;
    }
    const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
    return !!SpeechRecognition;
}

const failed = (code: string) => ({
    finished: Promise.reject(new Error(code)),
    cancel: () => {},
    stop: () => {},
});

export function startRecognize(onChange?: (text: string) => void) {
    console.log("start recognize");

    // Web Speech API 依赖安全上下文（HTTPS / localhost）
    if (window.isSecureContext === false) {
        return failed("insecure");
    }

    // 检查浏览器是否支持 Web Speech API
    const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        return failed("unsupported");
    }

    // 停止之前的识别
    if (currentRecognition) {
        currentRecognition.abort();
        currentRecognition = null;
    }

    const recognition = new SpeechRecognition();
    currentRecognition = recognition;

    // 配置识别参数
    recognition.continuous = true; // 持续识别
    recognition.interimResults = true; // 返回中间结果
    recognition.lang = "zh-CN"; // 设置语言为中文
    recognition.maxAlternatives = 1; // 最多返回一个识别结果

    let finalTranscript = "";
    let currentText = ""; // 保存当前完整文本（包括临时结果）
    let isCancelled = false;
    let isStopped = false; // 标记是否手动停止
    let settled = false;
    let noSpeech = false;
    let promiseResolve: (value: string) => void;
    let promiseReject: (reason: Error) => void;

    const resolveOnce = (value: string) => {
        if (settled) return;
        settled = true;
        promiseResolve(value);
    };
    const rejectOnce = (reason: Error) => {
        if (settled) return;
        settled = true;
        promiseReject(reason);
    };

    const finished = new Promise<string>((resolve, reject) => {
        promiseResolve = resolve;
        promiseReject = reject;

        // 处理识别结果
        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let interimTranscript = "";

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0].transcript;

                if (result.isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            // 保存当前完整文本（包括最终和临时结果）
            currentText = finalTranscript + interimTranscript;

            // 调用 onChange 回调，传递当前识别到的文本（包括最终和临时结果）
            if (onChange && currentText) {
                onChange(currentText);
            }
        };

        // 处理错误
        recognition.onerror = (event: SpeechRecognitionError) => {
            console.error("Recognition error:", event.error, event.message);

            // 手动取消的情况在 cancel 方法中处理
            if (isCancelled) {
                return;
            }

            // no-speech 不直接判失败，交给 onend 统一收尾，
            // 这样用户可能已经说出的临时结果仍有机会被使用。
            if (event.error === "no-speech") {
                noSpeech = true;
                return;
            }

            rejectOnce(
                new Error(
                    event.error === "aborted"
                        ? "recognition-aborted"
                        : event.error,
                ),
            );
            if (currentRecognition === recognition) {
                currentRecognition = null;
            }
        };

        // 识别结束
        recognition.onend = () => {
            console.log("Recognition ended");
            if (currentRecognition === recognition) {
                currentRecognition = null;
            }

            // 如果是取消操作，不执行 resolve
            if (isCancelled || settled) {
                return;
            }

            if (currentText.trim()) {
                // 手动停止或识别自然结束，只要有内容就返回
                resolveOnce(currentText);
                return;
            }

            // 没有任何识别结果：区分“用户没说话”与“识别服务异常结束”，
            // 避免调用方误以为流程正常完成。
            rejectOnce(
                new Error(
                    isStopped || noSpeech ? "no-speech" : "recognition-ended",
                ),
            );
        };

        // 开始识别
        try {
            recognition.start();
        } catch (error) {
            console.error("Failed to start recognition:", error);
            const name =
                error instanceof DOMException ? error.name : "start-failed";
            rejectOnce(
                new Error(name === "NotAllowedError" ? "not-allowed" : name),
            );
            if (currentRecognition === recognition) {
                currentRecognition = null;
            }
        }
    });

    return {
        finished,
        // 取消识别 - 让 finished Promise reject
        cancel: () => {
            console.log("cancel recognize");
            if (recognition && currentRecognition === recognition) {
                isCancelled = true;
                rejectOnce(new Error("aborted manually"));
                try {
                    recognition.abort();
                } catch {
                    // 识别已结束时 abort 可能抛错，忽略即可
                }
                currentRecognition = null;
            }
        },
        // 停止识别 - 让 finished Promise resolve
        stop: () => {
            console.log("stop recognize");
            if (recognition && currentRecognition === recognition) {
                isStopped = true; // 标记为手动停止
                try {
                    recognition.stop();
                } catch {
                    // 识别尚未真正启动时 stop 可能抛错，忽略即可
                }
            }
        },
    };
}

export function stopRecognize() {
    console.log("stop recognize");
    if (currentRecognition) {
        try {
            currentRecognition.stop();
        } catch {
            // ignore
        }
        currentRecognition = null;
    }
}
