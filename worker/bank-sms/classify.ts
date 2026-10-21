import {
	type Env,
	TAG_REPAYMENT_ID,
	TAG_REPAYMENT_NAME,
	TAG_REFUND_ID,
	TAG_REFUND_NAME,
	TAG_TRANSFER_ID,
	TAG_TRANSFER_NAME,
} from "../config";
import {
	type CategoryInfo,
	fallbackCategory,
	resolveCategory,
	resolveRefundCategory,
	resolveTag,
	type TagInfo,
} from "./categories";
import type { Confidence, Direction, NormalizedTx } from "./types";

type Rule = {
	type: Direction;
	keywords: string[];
	categoryId: string;
};

/**
 * 只放“商户关键词 -> Cent 分类 id”。
 * 匹配方式为 includes，允许银行把商户名截断。
 */
const RULES: Rule[] = [
	{
		type: "expense",
		keywords: [
			"美团",
			"饿了么",
			"拉扎斯",
			"糕点",
			"牛肉汤",
			"火锅",
			"猪脚饭",
			"老乡鸡",
			"餐厅",
			"食堂",
			"外卖",
			"星巴克",
			"瑞幸",
			"肯德基",
			"麦当劳",
			"餐饮",
		],
		categoryId: "food",
	},
	{
		type: "expense",
		keywords: [
			"滴滴",
			"高德",
			"曹操",
			"T3",
			"地铁",
			"公交",
			"12306",
			"铁路",
			"航空",
			"中国石化",
			"石化加油站",
			"加油",
			"高速公路",
			"高速",
			"ETC",
			"停车",
			"铁塔能源",
			"金电新能源",
			"充电",
		],
		categoryId: "transport",
	},
	{
		type: "expense",
		keywords: [
			"淘宝",
			"天猫",
			"京东",
			"拼多多",
			"唯品会",
			"苏宁",
			"超市",
			"便利店",
			"沃尔玛",
			"永辉",
			"盒马",
			"万达",
			"阿里",
		],
		categoryId: "shopping",
	},
	{
		type: "expense",
		keywords: ["房租", "物业", "水费", "电费", "燃气", "宽带"],
		categoryId: "housing",
	},
	{
		type: "expense",
		keywords: [
			"电影",
			"猫眼",
			"淘票票",
			"腾讯视频",
			"爱奇艺",
			"优酷",
			"网易云",
			"Steam",
			"游戏",
			"健身",
			"卡路里科技",
		],
		categoryId: "entertainment",
	},
	{
		type: "expense",
		keywords: ["医院", "药房", "药店", "诊所"],
		categoryId: "medical",
	},
	{
		type: "expense",
		keywords: ["学费", "培训", "教育", "书店"],
		categoryId: "education",
	},
	{
		type: "income",
		keywords: ["工资", "薪资", "代发", "奖金"],
		categoryId: "wage",
	},
];

export type Classification = {
	action: "create" | "skip";
	categoryId?: string;
	tagIds?: string[];
	comment?: string;
	reason?: string;
	confidence: Confidence;
};

function makeComment(
	tx: NormalizedTx,
	marker?: string,
	extra?: string,
): string {
	const parts: string[] = [];
	if (tx.merchant) {
		parts.push(tx.merchant);
	} else if (tx.counterparty) {
		parts.push(tx.counterparty);
	} else if (tx.subtype && tx.subtype !== "unknown") {
		parts.push(tx.subtype);
	}
	if (tx.cardTail) parts.push(`尾号${tx.cardTail}`);
	if (tx.counterpartyCard) parts.push(`对方尾号${tx.counterpartyCard}`);
	if (marker) parts.push(`[${marker}]`);
	if (extra) parts.push(extra);
	return parts.join(" · ").slice(0, 120);
}

export async function classify(
	tx: NormalizedTx,
	categories: CategoryInfo[],
	tags: TagInfo[],
	env: Env,
): Promise<Classification> {
	const merchant = tx.merchant ?? "";
	const inner = [tx.subtype, tx.channel, merchant]
		.filter(Boolean)
		.join("-");

	// 1. 微信零钱 / 支付宝余额充值：内部转账，跳过
	if (
		tx.subtype === "充值" &&
		/微信零钱|支付宝余额|余额充值/.test(merchant)
	) {
		return {
			action: "skip",
			reason: "wallet-topup",
			confidence: "high",
		};
	}

	// 2. 退款：收入，新建的“退款”分类
	if (
		tx.direction === "income" &&
		(tx.subtype === "退款" || /退款/.test(inner))
	) {
		return {
			action: "create",
			categoryId: resolveRefundCategory(categories),
			tagIds: [resolveTag(tags, TAG_REFUND_NAME, TAG_REFUND_ID)],
			comment: makeComment(tx, TAG_REFUND_NAME),
			confidence: "high",
		};
	}

	// 3. 信用卡还款：默认记支出，可通过配置改成跳过
	if (/信用卡还款/.test(inner) || tx.subtype === "还款") {
		const isCreditCard = /信用卡/.test(inner);
		if (isCreditCard && env.CREDIT_CARD_REPAYMENT_POLICY === "skip") {
			return {
				action: "skip",
				reason: "credit-card-repayment",
				confidence: "high",
			};
		}
		const categoryId =
			resolveCategory(categories, "other-expenses", "expense") ??
			fallbackCategory(env, categories, "expense");
		return {
			action: "create",
			categoryId,
			tagIds: [
				resolveTag(tags, TAG_REPAYMENT_NAME, TAG_REPAYMENT_ID),
			],
			comment: makeComment(tx, TAG_REPAYMENT_NAME),
			confidence: "high",
		};
	}

	// 4. 转账 / 二维码付款：记支出或收入，并标记待确认
	if (tx.subtype === "转账") {
		const categoryId =
			resolveCategory(
				categories,
				tx.direction === "expense"
					? "other-expenses"
					: "other-income",
				tx.direction,
			) ?? fallbackCategory(env, categories, tx.direction);
		return {
			action: "create",
			categoryId,
			tagIds: [resolveTag(tags, TAG_TRANSFER_NAME, TAG_TRANSFER_ID)],
			comment: makeComment(tx, TAG_TRANSFER_NAME),
			confidence: "medium",
		};
	}

	// 5. 他行汇入 / 银联入账
	if (tx.subtype === "他行汇入" || tx.subtype === "银联入账") {
		const categoryId =
			resolveCategory(categories, "other-income", "income") ??
			fallbackCategory(env, categories, "income");
		return {
			action: "create",
			categoryId,
			comment: makeComment(tx),
			confidence: "high",
		};
	}

	// 6. 取现 / 手续费
	if (tx.subtype === "取现" || tx.subtype === "手续费") {
		const categoryId =
			resolveCategory(categories, "other-expenses", "expense") ??
			fallbackCategory(env, categories, "expense");
		return {
			action: "create",
			categoryId,
			comment: makeComment(tx),
			confidence: "medium",
		};
	}

	// 7. 商户关键词规则
	const rule = RULES.find(
		(r) =>
			r.type === tx.direction &&
			r.keywords.some((keyword) => merchant.includes(keyword)),
	);
	if (rule) {
		const categoryId = resolveCategory(
			categories,
			rule.categoryId,
			tx.direction,
		);
		if (categoryId) {
			return {
				action: "create",
				categoryId,
				comment: makeComment(tx),
				confidence: "high",
			};
		}
	}

	// 8. LLM 兜底（只做分类，不参与金额解析）
	const llm = await classifyWithLlm(tx, categories, env);
	if (llm) {
		return {
			action: "create",
			categoryId: llm.categoryId,
			comment: makeComment(tx, undefined, llm.comment),
			confidence: "medium",
		};
	}

	// 9. 最终兜底
	return {
		action: "create",
		categoryId: fallbackCategory(env, categories, tx.direction),
		comment: makeComment(tx, "待确认"),
		confidence: "low",
	};
}

async function classifyWithLlm(
	tx: NormalizedTx,
	categories: CategoryInfo[],
	env: Env,
): Promise<{ categoryId: string; comment?: string } | null> {
	if (
		!env.LLM_BASE_URL ||
		!env.LLM_API_KEY ||
		!env.LLM_MODEL
	) {
		return null;
	}

	const options = categories
		.filter((c) => c.type === tx.direction)
		.map((c) => `${c.id}\t${c.nameZh}`)
		.join("\n");

	const prompt = [
		"你是记账分类器。根据银行动账信息，从下面的分类中选一个最合适的。",
		"只能返回 JSON，格式：{\"categoryId\":\"分类id\",\"comment\":\"可选备注\"}。",
		"不能返回列表之外的 categoryId。",
		"",
		`分类列表（id\\t名称）：\n${options}`,
		"",
		`交易信息：方向=${tx.direction}，金额=${tx.amountYuan}元，商户=${tx.merchant ?? ""}，子类型=${tx.subtype ?? ""}，通道=${tx.channel ?? ""}。`,
	].join("\n");

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 5000);

	try {
		const base = env.LLM_BASE_URL.replace(/\/$/, "");
		const res = await fetch(`${base}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.LLM_API_KEY}`,
			},
			body: JSON.stringify({
				model: env.LLM_MODEL,
				temperature: 0,
				messages: [
					{ role: "system", content: prompt },
					{
						role: "user",
						content: `${tx.rawPreview}`,
					},
				],
			}),
			signal: controller.signal,
		});

		if (!res.ok) return null;
		const data: any = await res.json();
		const raw = data?.choices?.[0]?.message?.content;
		if (typeof raw !== "string") return null;

		const parsed = JSON.parse(
			raw
				.replace(/```json/gi, "")
				.replace(/```/g, "")
				.trim(),
		);
		const categoryId = resolveCategory(
			categories,
			String(parsed?.categoryId ?? ""),
			tx.direction,
		);
		if (!categoryId) return null;

		return {
			categoryId,
			comment:
				typeof parsed?.comment === "string"
					? parsed.comment
					: undefined,
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
