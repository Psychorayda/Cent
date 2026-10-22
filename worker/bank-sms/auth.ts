import type { Env } from "../config";
import { sha256Hex } from "../lib";
import { verifyToken } from "./token";

function getBearer(request: Request): string | undefined {
    const auth = request.headers.get("Authorization") ?? "";
    if (auth.toLowerCase().startsWith("bearer ")) {
        return auth.slice(7).trim();
    }
    return undefined;
}

/** 短信侧凭证：Header 优先，其次 Bearer，最后 query（兼容只能拼 URL 的转发器） */
export function getRequestToken(request: Request): string | undefined {
    return (
        request.headers.get("X-Cent-Token") ??
        getBearer(request) ??
        new URL(request.url).searchParams.get("token") ??
        undefined
    );
}

/** 短信入口鉴权：校验签名 token，返回 uid */
export async function resolveSmsUser(
    request: Request,
    env: Env,
): Promise<string | null> {
    const token = getRequestToken(request);
    if (!token) return null;
    return verifyToken(env, token);
}

export type GithubIdentity = {
    id: string;
    login: string;
};

/** 客户端鉴权：用 GitHub token 换取 uid + login */
export async function getGithubIdentity(
    request: Request,
    env: Env,
): Promise<GithubIdentity | null> {
    const token = getBearer(request);
    if (!token) return null;

    const cacheKey = `ghuser:${await sha256Hex(token)}`;
    const cached = (await env.INBOX_KV.get(
        cacheKey,
        "json",
    )) as GithubIdentity | null;
    if (cached?.id) return cached;

    const res = await fetch("https://api.github.com/user", {
        headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "cent-worker",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    if (!res.ok) return null;

    const data: any = await res.json();
    const id = String(data?.id ?? "");
    const login = String(data?.login ?? "");
    if (!id) return null;

    const identity = { id, login };
    await env.INBOX_KV.put(cacheKey, JSON.stringify(identity), {
        expirationTtl: 600,
    });
    return identity;
}
