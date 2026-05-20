import { USER_PASSWORD, ADMIN_PASSWORD } from './config';

export type AuthLevel = 'user' | 'admin';

export function checkAuth(req: Request): AuthLevel | null {
	const header = req.headers.get('x-limp-password');
	if (!header) return null;
	if (header === ADMIN_PASSWORD) return 'admin';
	if (header === USER_PASSWORD) return 'user';
	return null;
}

export function requireAuth(req: Request, level: AuthLevel = 'user'): AuthLevel | Response {
	const auth = checkAuth(req);
	if (!auth) return new Response('Unauthorized', { status: 401 });
	if (level === 'admin' && auth !== 'admin')
		return new Response('Forbidden', { status: 403 });
	return auth;
}

export function isResponse(v: unknown): v is Response {
	return v instanceof Response;
}
