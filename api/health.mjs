export default function handler(request, response) {
	response.setHeader("Cache-Control", "no-store");
	if (request.method !== "GET") {
		return response.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
	}
	return response.status(200).json({ ok: true, service: "friend-apply" });
}
