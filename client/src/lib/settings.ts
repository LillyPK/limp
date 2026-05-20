import { writable, derived } from 'svelte/store';

type Settings = {
	dataSaver: boolean;
	extremeDataSaver: boolean;
	playRelated: boolean;
};

function createSettings() {
	let initial: Settings = { dataSaver: false, extremeDataSaver: false, playRelated: false };
	if (typeof localStorage !== 'undefined') {
		try { initial = { ...initial, ...JSON.parse(localStorage.getItem('limp_settings') ?? '{}') }; } catch {}
	}

	const store = writable<Settings>(initial);

	return {
		subscribe: store.subscribe,
		toggle(key: keyof Settings) {
			store.update(s => {
				const next = { ...s, [key]: !s[key] };
				if (key === 'extremeDataSaver' && next.extremeDataSaver) next.dataSaver = false;
				if (key === 'dataSaver' && next.dataSaver) next.extremeDataSaver = false;
				localStorage.setItem('limp_settings', JSON.stringify(next));
				return next;
			});
		}
	};
}

export const settings = createSettings();

export const artMode = derived(settings, $s =>
	$s.extremeDataSaver ? 'none' : $s.dataSaver ? 'lq' : 'full'
) as import('svelte/store').Readable<'full' | 'lq' | 'none'>;
