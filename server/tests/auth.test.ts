import { describe, it, expect, beforeAll } from 'bun:test';
import { queries } from '../db';

// Seed a test user
beforeAll(() => {
	try { queries.createUser.get('testuser', 0); } catch { /* already exists */ }
	try { queries.createUser.get('adminuser', 1); } catch { /* already exists */ }
});

async function login(username: string, password: string) {
	return fetch('http://localhost:3001/api/login', {
		method: 'POST',
		headers: { 'x-limp-username': username, 'x-limp-password': password }
	});
}

// Start a test server on port 3001
import { PORT } from '../config';

let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
	// Import the router inline to avoid starting main server
	const { default: testApp } = await import('./test-server');
	server = testApp;
});

describe('auth gates', () => {
	it('rejects login with wrong password', async () => {
		const res = await login('testuser', 'wrongpassword');
		expect(res.status).toBe(401);
	});

	it('allows user login with user password', async () => {
		const res = await login('testuser', 'idgaf');
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.user.username).toBe('testuser');
	});

	it('allows admin login with admin password', async () => {
		const res = await login('adminuser', '1234asdf');
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.user.is_admin).toBe(1);
	});

	it('rejects admin user with user password', async () => {
		const res = await login('adminuser', 'idgaf');
		expect(res.status).toBe(403);
	});

	it('rejects user with admin password', async () => {
		const res = await login('testuser', '1234asdf');
		expect(res.status).toBe(403);
	});

	it('rejects catalog access without password', async () => {
		const res = await fetch('http://localhost:3001/api/songs');
		expect(res.status).toBe(401);
	});
});
