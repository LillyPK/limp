<script lang="ts">
	import { session } from '$lib/session';
	import { login } from '$lib/api';
	import { goto } from '$app/navigation';

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		error = '';
		try {
			const result = await login(username, password);
			if (result.ok && result.user) {
				session.login({ user: result.user, password });
				goto('/');
			} else {
				error = result.error ?? 'Invalid credentials';
			}
		} catch {
			error = 'Could not reach server';
		} finally {
			loading = false;
		}
	}
</script>

<div class="min-h-screen bg-surface-900 flex items-center justify-center p-4">
	<div class="w-full max-w-sm">
		<div class="text-center mb-8">
			<h1 class="text-4xl font-bold text-primary-400 tracking-tight">limp</h1>
			<p class="text-surface-400 text-sm mt-1">lilly's impressive music play</p>
		</div>

		<form onsubmit={submit} class="bg-surface-800 rounded-2xl p-6 space-y-4 shadow-xl">
			<div class="space-y-1">
				<label for="username" class="text-xs font-medium text-surface-300 uppercase tracking-wide">Username</label>
				<input
					id="username"
					type="text"
					bind:value={username}
					required
					autocomplete="username"
					class="w-full bg-surface-700 border border-surface-600 rounded-lg px-4 py-3 text-surface-50 placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
					placeholder="your username"
				/>
			</div>

			<div class="space-y-1">
				<label for="password" class="text-xs font-medium text-surface-300 uppercase tracking-wide">Password</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					required
					autocomplete="current-password"
					class="w-full bg-surface-700 border border-surface-600 rounded-lg px-4 py-3 text-surface-50 placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
					placeholder="••••••••"
				/>
			</div>

			{#if error}
				<p class="text-error-400 text-sm">{error}</p>
			{/if}

			<button
				type="submit"
				disabled={loading}
				class="w-full bg-primary-500 hover:bg-primary-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 transition-colors"
			>
				{loading ? 'Signing in…' : 'Sign in'}
			</button>
		</form>
	</div>
</div>
