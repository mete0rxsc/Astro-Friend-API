const KEEPALIVE_KEY = "friend-apply:keepalive";
const KEEPALIVE_TTL_SECONDS = 30 * 24 * 60 * 60;

const send = (response, status, body) => response.status(status).json(body);

/**
 * Vercel Cron calls this function twice a day. The write uses a dedicated key
 * so it never changes the friend-apply rate-limit counters.
 */
export default async function handler(request, response) {
	response.setHeader("Cache-Control", "no-store");

	if (request.method !== "GET") {
		return send(response, 405, {
			ok: false,
			code: "METHOD_NOT_ALLOWED",
			message: "Only GET requests are allowed.",
		});
	}

	const endpoint = String(process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
	const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || "");
	if (!endpoint || !token) {
		return send(response, 503, {
			ok: false,
			code: "UPSTASH_CONFIG",
			message: "Upstash is not configured.",
		});
	}

	try {
		const result = await fetch(`${endpoint}/pipeline`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify([[
				"SET",
				KEEPALIVE_KEY,
				new Date().toISOString(),
				"EX",
				KEEPALIVE_TTL_SECONDS,
			]]),
		});

		if (!result.ok) throw new Error("UPSTASH_ERROR");
		return send(response, 200, {
			ok: true,
			service: "friend-apply",
			redis: "alive",
		});
	} catch {
		return send(response, 502, {
			ok: false,
			code: "UPSTASH_ERROR",
			message: "Keepalive failed.",
		});
	}
}

export { KEEPALIVE_KEY, KEEPALIVE_TTL_SECONDS };
