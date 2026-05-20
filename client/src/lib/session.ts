import { writable } from 'svelte/store';
import type { Session } from './api';

function createSessionStore() {
	let initial: Session | null = null;
	if (typeof localStorage !== 'undefined') {
		const raw = localStorage.getItem('limp_session');
		if (raw) {
			try { initial = JSON.parse(raw); } catch { /**/ }
		}
	}

	const { subscribe, set } = writable<Session | null>(initial);

	return {
		subscribe,
		login(session: Session) {
			localStorage.setItem('limp_session', JSON.stringify(session));
			set(session);
		},
		logout() {
			localStorage.removeItem('limp_session');
			set(null);
		}
	};
}

export const session = createSessionStore();
