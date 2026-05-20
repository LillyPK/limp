import { checkAuth } from '../auth';
import { queries } from '../db';
import { ADMIN_PASSWORD } from '../config';

export function handleLogin(req: Request): Response {
	const auth = checkAuth(req);
	if (!auth) return jsonErr('Unauthorized', 401);

	const password = req.headers.get('x-limp-password')!;
	const username = req.headers.get('x-limp-username') ?? '';
	const user = queries.getUserByUsername.get(username);

	if (!user) return jsonErr('unknown user', 401);

	const expectAdmin = password === ADMIN_PASSWORD;
	if (expectAdmin && !user.is_admin) return jsonErr('not admin', 403);
	if (!expectAdmin && user.is_admin) return jsonErr('use admin password', 403);

	return json({ ok: true, user: { id: user.id, username: user.username, is_admin: user.is_admin } });
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function jsonErr(error: string, status: number): Response {
	return json({ ok: false, error }, status);
}
