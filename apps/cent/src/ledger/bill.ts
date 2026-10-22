import type { Amount, Bill } from "./type";

export const amountToNumber = (v: Amount) => v / 10000;

export const numberToAmount = (v: number) => Number((v * 10000).toFixed(0));

export const isValidNumberForAmount = (v: number) => {
    const tmp = numberToAmount(v);
    if (tmp.toString().includes(".")) {
        return false;
    }
    return true;
};

const PENDING_TRANSFER_TAG_ID = "bank-transfer-pending";
const PENDING_TRANSFER_MARKER = "[转账待确认]";

/**
 * 人工修改分类后，清除银行短信自动打上的“转账待确认”标记。
 * 只处理分类确实发生变化的账单。
 */
export const clearPendingTransferMark = (
    bill: Omit<Bill, "id" | "creatorId">,
    prevCategoryId?: string,
): Omit<Bill, "id" | "creatorId"> => {
    if (prevCategoryId === undefined || bill.categoryId === prevCategoryId) {
        return bill;
    }

    const hasTag = bill.tagIds?.includes(PENDING_TRANSFER_TAG_ID) ?? false;
    const hasMarker = bill.comment?.includes(PENDING_TRANSFER_MARKER) ?? false;
    if (!hasTag && !hasMarker) {
        return bill;
    }

    return {
        ...bill,
        tagIds: bill.tagIds?.filter((id) => id !== PENDING_TRANSFER_TAG_ID),
        comment: bill.comment
            ?.replace(/\s*·\s*\[转账待确认\]/g, "")
            .replace(/\[转账待确认\]\s*·?\s*/g, "")
            .trim(),
    };
};
