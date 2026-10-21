export type Direction = "expense" | "income";
export type Confidence = "high" | "medium" | "low";

export type BankSmsPayload = {
	from: string;
	content: string;
	ts: string | number;
};

export type NormalizedTx = {
	source: "bank-sms";
	bank?: string;
	cardTail?: string;
	direction: Direction;
	subtype?: string;
	channel?: string;
	/** 整数金额，10000 = 1 元 */
	amount: number;
	amountYuan: number;
	currency: "CNY";
	occurredAt: number;
	merchant?: string;
	counterparty?: string;
	counterpartyCard?: string;
	serialNo?: string;
	/** 整数余额，10000 = 1 元 */
	balance?: number;
	rawHash: string;
	rawPreview: string;
	parser: "icbc" | "generic";
	confidence: Confidence;
};

export type ParseOutcome =
	| { ok: true; tx: NormalizedTx }
	| {
			ok: false;
			reason: string;
			bank?: string;
			rawHash: string;
			rawPreview: string;
	  };

export type InboxBill = {
	type: Direction;
	categoryId: string;
	amount: number;
	time: number;
	comment?: string;
	tagIds?: string[];
};

export type InboxItem = {
	id: string;
	bookId: string;
	bill: InboxBill;
	meta: {
		bank?: string;
		cardTail?: string;
		subtype?: string;
		channel?: string;
		parser: string;
		confidence: Confidence;
		balance?: number;
		occurredAt: number;
	};
	createdAt: number;
};
