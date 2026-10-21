import { BillCategories } from "../../apps/cent/src/ledger/category";
import zh from "../../apps/cent/src/locale/lang/zh.json";
import {
	DEFAULT_EXPENSE_CATEGORY,
	DEFAULT_INCOME_CATEGORY,
	type Env,
	REFUND_CATEGORY_ID,
} from "../config";
import type { Direction } from "./types";

const zhMap = zh as Record<string, string>;

export type CategoryInfo = {
	id: string;
	type: Direction;
	name: string;
	nameZh: string;
	parent?: string;
};

export type TagInfo = {
	id: string;
	name: string;
};

const ghHeaders = (env: Env) => ({
	Authorization: `Bearer ${env.GITHUB_TOKEN ?? ""}`,
	"User-Agent": "cent-worker",
	"X-GitHub-Api-Version": "2022-11-28",
});

/**
 * 优先使用配置的仓库；否则自动找第一个 cent-journal-* 私有仓库。
 */
export async function resolveRepo(env: Env): Promise<string> {
	const configured = env.GITHUB_REPO?.trim();
	if (configured) return configured;

	const cached = await env.INBOX_KV.get("repo:default");
	if (cached) return cached;

	if (!env.GITHUB_TOKEN) return "";

	const res = await fetch(
		"https://api.github.com/user/repos?per_page=100&affiliation=owner&sort=updated",
		{ headers: ghHeaders(env) },
	);
	if (!res.ok) return "";

	const repos = (await res.json()) as Array<{
		name?: string;
		full_name?: string;
	}>;
	const repo =
		repos.find((r) => r.name?.startsWith("cent-journal-"))?.full_name ?? "";
	if (repo) {
		await env.INBOX_KV.put("repo:default", repo, { expirationTtl: 600 });
	}
	return repo;
}

export async function getMeta(env: Env, repo: string): Promise<any | null> {
	if (!repo || !env.GITHUB_TOKEN) return null;

	const cacheKey = `meta:${repo}`;
	const cached = await env.INBOX_KV.get(cacheKey, "json");
	if (cached) return cached;

	const res = await fetch(
		`https://api.github.com/repos/${repo}/contents/meta.json`,
		{
			headers: {
				...ghHeaders(env),
				Accept: "application/vnd.github.raw",
			},
		},
	);
	if (!res.ok) return null;

	try {
		const data = await res.json();
		await env.INBOX_KV.put(cacheKey, JSON.stringify(data), {
			expirationTtl: 600,
		});
		return data;
	} catch {
		return null;
	}
}

export async function getCategories(
	env: Env,
	repo: string,
): Promise<CategoryInfo[]> {
	const meta = await getMeta(env, repo);

	const defaults: CategoryInfo[] = BillCategories.map((c) => ({
		id: c.id,
		type: c.type,
		name: c.name,
		nameZh: zhMap[c.name] ?? c.name,
		parent: c.parent,
	}));

	const list = Array.isArray(meta?.categories) ? meta.categories : [];
	const custom: CategoryInfo[] = list.map((c: any) => ({
		id: String(c.id),
		type: c.type === "income" ? "income" : "expense",
		name: String(c.name ?? ""),
		nameZh: c.customName
			? String(c.name ?? "")
			: (zhMap[String(c.name ?? "")] ?? String(c.name ?? "")),
		parent: c.parent,
	}));

	const map = new Map<string, CategoryInfo>();
	for (const item of defaults) map.set(item.id, item);
	for (const item of custom) map.set(item.id, item);
	return [...map.values()];
}

export async function getTags(env: Env, repo: string): Promise<TagInfo[]> {
	const meta = await getMeta(env, repo);
	const list = Array.isArray(meta?.tags) ? meta.tags : [];
	return list
		.map((t: any) => ({ id: String(t.id), name: String(t.name ?? "") }))
		.filter((t: TagInfo) => Boolean(t.id));
}

export function resolveCategory(
	categories: CategoryInfo[],
	idOrName: string,
	type: Direction,
): string | undefined {
	const byId = categories.find((c) => c.id === idOrName && c.type === type);
	if (byId) return byId.id;

	const byName = categories.find(
		(c) =>
			c.type === type &&
			(c.name === idOrName || c.nameZh === idOrName),
	);
	return byName?.id;
}

export function resolveRefundCategory(
	categories: CategoryInfo[],
): string {
	return (
		categories.find(
			(c) =>
				c.type === "income" &&
				(c.name === "退款" || c.nameZh === "退款"),
		)?.id ??
		categories.find(
			(c) => c.type === "income" && c.id === REFUND_CATEGORY_ID,
		)?.id ??
		REFUND_CATEGORY_ID
	);
}

export function fallbackCategory(
	env: Env,
	categories: CategoryInfo[],
	type: Direction,
): string {
	const configured =
		type === "expense"
			? env.FALLBACK_EXPENSE_CATEGORY
			: env.FALLBACK_INCOME_CATEGORY;
	const preferred = configured?.trim();

	if (preferred) {
		const resolved = resolveCategory(categories, preferred, type);
		if (resolved) return resolved;
	}

	const defaultId =
		type === "expense"
			? DEFAULT_EXPENSE_CATEGORY
			: DEFAULT_INCOME_CATEGORY;
	const resolved = resolveCategory(categories, defaultId, type);
	if (resolved) return resolved;

	return (
		categories.find((c) => c.type === type)?.id ?? defaultId
	);
}

export function resolveTag(
	tags: TagInfo[],
	name: string,
	fallbackId: string,
): string {
	return (
		tags.find((t) => t.name === name)?.id ??
		tags.find((t) => t.id === fallbackId)?.id ??
		fallbackId
	);
}
