import type { Env } from "../config";
import { safeEqual } from "../lib";

/** token 格式: c1.<uid>.<version>.<signature> */
const PREFIX = "c1";

function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

async function sign(secret: string, payload: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(payload),
    );
    return toBase64Url(new Uint8Array(signature));
}

/** 每用户一个版本号，用于吊销/轮换；默认 0 */
async function getVersion(env: Env, uid: string): Promise<string> {
    return (await env.INBOX_KV.get(`tokenver:${uid}`)) ?? "0";
}

async function signToken(
    env: Env,
    uid: string,
    version: string,
): Promise<string> {
    const secret = env.CENT_TOKEN_SECRET ?? "";
    if (!secret) throw new Error("CENT_TOKEN_SECRET is not configured");

    const payload = `${PREFIX}.${uid}.${version}`;
    return `${payload}.${await sign(secret, payload)}`;
}

export async function issueToken(env: Env, uid: string): Promise<string> {
    return signToken(env, uid, await getVersion(env, uid));
}

/** 写入新版本号（旧 token 立即失效），并返回新 token */
export async function resetToken(env: Env, uid: string): Promise<string> {
    const version = String(Date.now());
    await env.INBOX_KV.put(`tokenver:${uid}`, version);
    return signToken(env, uid, version);
}

/** 校验通过返回 uid，否则返回 null */
export async function verifyToken(
    env: Env,
    token: string,
): Promise<string | null> {
    const secret = env.CENT_TOKEN_SECRET ?? "";
    if (!secret || !token || token.length > 200) return null;

    const parts = token.split(".");
    if (parts.length !== 4) return null;

    const [prefix, uid, version, signature] = parts;
    if (prefix !== PREFIX) return null;
    if (!/^\d{1,20}$/.test(uid) || !/^\d{1,20}$/.test(version)) return null;

    const expected = await sign(secret, `${prefix}.${uid}.${version}`);
    if (!safeEqual(signature, expected)) return null;

    if (version !== (await getVersion(env, uid))) return null;

    return uid;
}
