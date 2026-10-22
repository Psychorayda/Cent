export type RateLimitBinding = {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
};

export type Env = {
    INBOX_KV: any;
    ASSETS: { fetch: (request: Request) => Promise<Response> };
    GITHUB_TOKEN?: string;
    /** 短信 token 的 HMAC 密钥 */
    CENT_TOKEN_SECRET?: string;
    /** Cloudflare Rate Limiting 绑定 */
    SMS_RATE_LIMITER?: RateLimitBinding;
    TOKEN_RATE_LIMITER?: RateLimitBinding;
    FALLBACK_EXPENSE_CATEGORY?: string;
    FALLBACK_INCOME_CATEGORY?: string;
    CREDIT_CARD_REPAYMENT_POLICY?: string;
    LLM_BASE_URL?: string;
    LLM_MODEL?: string;
    LLM_API_KEY?: string;
};

export const DEFAULT_EXPENSE_CATEGORY = "other-expenses";
export const DEFAULT_INCOME_CATEGORY = "other-income";

export const REFUND_CATEGORY_ID = "refund";
export const TAG_REFUND_ID = "bank-refund";
export const TAG_TRANSFER_ID = "bank-transfer-pending";
export const TAG_REPAYMENT_ID = "bank-credit-card-repayment";

export const TAG_REFUND_NAME = "退款";
export const TAG_TRANSFER_NAME = "转账待确认";
export const TAG_REPAYMENT_NAME = "信用卡还款";
