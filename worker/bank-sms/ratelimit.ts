import type { RateLimitBinding } from "../config";

/**
 * Cloudflare Rate Limiting 绑定。
 * 绑定缺失或调用异常时放行，避免限流组件故障影响主流程。
 */
export async function allowRequest(
    binding: RateLimitBinding | undefined,
    key: string,
): Promise<boolean> {
    if (!binding) return true;

    try {
        const { success } = await binding.limit({ key });
        return success;
    } catch (error) {
        console.warn("[bank-sms] rate limiter unavailable", error);
        return true;
    }
}

export function clientIp(request: Request): string {
    return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
