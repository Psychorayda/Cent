import { preview } from "../../lib";
import type { BankSmsPayload, ParseOutcome } from "../types";
import { parseGeneric } from "./generic";
import { parseIcbc } from "./icbc";

export function parseBankSms(
	payload: BankSmsPayload,
	rawHash: string,
	receivedAt: number,
	bank?: string,
): ParseOutcome {
	if (bank === "工商银行") {
		const tx = parseIcbc(payload, rawHash, receivedAt, bank);
		if (tx) return { ok: true, tx };
	}

	const tx = parseGeneric(payload, rawHash, receivedAt, bank);
	if (tx) return { ok: true, tx };

	return {
		ok: false,
		reason: "unparsed",
		bank,
		rawHash,
		rawPreview: preview(payload.content),
	};
}
