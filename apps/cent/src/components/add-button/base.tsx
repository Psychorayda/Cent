import type { HtmlHTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils";

export function BaseButton({
    children,
    className,
    ...props
}: { children?: ReactNode } & HtmlHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type="button"
            className={cn(
                // touch-none / select-none / touch-callout 用于移动端长按手势，
                // 避免系统上下文菜单或文本选择打断 pointer 事件
                "w-18 h-18 sm:w-14 sm:h-14 rounded-full bg-stone-900 shadow-md flex items-center justify-center m-1 cursor-pointer transform transition-all hover:scale-105 select-none touch-none [-webkit-touch-callout:none]",
                className,
            )}
            {...props}
        >
            {children}
        </button>
    );
}
