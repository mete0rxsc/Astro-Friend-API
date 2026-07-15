export default function handler(_request, response) {
	response.setHeader("Cache-Control", "no-store");
	return response.status(200).json({ ok: true, service: "friend-apply" });
}
