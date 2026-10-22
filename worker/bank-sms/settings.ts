import type { Env } from "../config";
import { json } from "../lib";
import { getGithubIdentity } from "./auth";

/** GitHub 仓库全名：owner/repo */
const BOOK_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

export async function getDefaultBook(
    env: Env,
    uid: string,
): Promise<string | null> {
    const value = await env.INBOX_KV.get(`defaultbook:${uid}`);
    return value && BOOK_RE.test(value) ? value : null;
}

/** GET /api/default-book | PUT /api/default-book */
export async function handleDefaultBook(
    request: Request,
    env: Env,
): Promise<Response> {
    const identity = await getGithubIdentity(request, env);
    if (!identity) {
        return json({ ok: false, error: "unauthorized" }, 401);
    }

    if (request.method === "GET") {
        return json({
            ok: true,
            defaultBook: await getDefaultBook(env, identity.id),
        });
    }

    if (request.method === "PUT") {
        let data: any;
        try {
            data = await request.json();
        } catch {
            return json({ ok: false, error: "invalid-json" }, 400);
        }

        const raw = data?.defaultBook;
        if (raw === null || raw === undefined || raw === "") {
            await env.INBOX_KV.delete(`defaultbook:${identity.id}`);
            return json({ ok: true, defaultBook: null });
        }

        const bookId = String(raw).trim();
        if (!BOOK_RE.test(bookId)) {
            return json({ ok: false, error: "invalid-book" }, 400);
        }
        await env.INBOX_KV.put(`defaultbook:${identity.id}`, bookId);
        return json({ ok: true, defaultBook: bookId });
    }

    return json({ ok: false, error: "method-not-allowed" }, 405);
}
