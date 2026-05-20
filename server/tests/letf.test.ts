import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { packLetf } from '../letf';
import { decrypt } from '../crypto';
import { unzipSync } from 'fflate';
import { join } from 'path';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';

const PASSWORD = 'idgaf';
let tmpDir: string;
let songPath: string;
let artPath: string;

beforeAll(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), 'limp-test-'));
	songPath = join(tmpDir, 'test.mp3');
	artPath = join(tmpDir, 'art.jpg');
	// Write fake audio and image bytes
	await writeFile(songPath, Buffer.from('fake-mp3-bytes'));
	await writeFile(artPath, Buffer.from('fake-jpg-bytes'));
});

afterAll(async () => {
	await rm(tmpDir, { recursive: true });
});

describe('letf packing', () => {
	it('packs song + art into encrypted zip (full art mode)', async () => {
		const letf = await packLetf(songPath, artPath, 'full', PASSWORD);
		const zipped = await decrypt(letf, PASSWORD);
		const files = unzipSync(zipped);

		expect(Object.keys(files)).toContain('song.mp3');
		expect(Object.keys(files)).toContain('art.jpg');
		expect(new TextDecoder().decode(files['song.mp3'])).toBe('fake-mp3-bytes');
		expect(new TextDecoder().decode(files['art.jpg'])).toBe('fake-jpg-bytes');
	});

	it('omits art in no_album_art mode', async () => {
		const letf = await packLetf(songPath, artPath, 'none', PASSWORD);
		const zipped = await decrypt(letf, PASSWORD);
		const files = unzipSync(zipped);

		expect(Object.keys(files)).toContain('song.mp3');
		expect(Object.keys(files)).not.toContain('art.jpg');
	});

	it('is decryptable only with the correct password', async () => {
		const letf = await packLetf(songPath, artPath, 'full', PASSWORD);
		await expect(decrypt(letf, 'wrong')).rejects.toThrow();
	});
});
