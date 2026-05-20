import { describe, it, expect } from 'bun:test';
import { encrypt, decrypt, encryptJSON, decryptJSON } from '../crypto';

const PASSWORD = 'test-password-123';

describe('crypto', () => {
	it('round-trips raw bytes', async () => {
		const original = new TextEncoder().encode('hello world');
		const ciphertext = await encrypt(original, PASSWORD);
		const recovered = await decrypt(ciphertext, PASSWORD);
		expect(recovered).toEqual(original);
	});

	it('round-trips JSON', async () => {
		const obj = { songs: [{ id: 1, title: 'Test Song' }] };
		const enc = await encryptJSON(obj, PASSWORD);
		const dec = await decryptJSON<typeof obj>(enc, PASSWORD);
		expect(dec).toEqual(obj);
	});

	it('produces different ciphertexts for same input (random IV/salt)', async () => {
		const plain = new TextEncoder().encode('same input');
		const c1 = await encrypt(plain, PASSWORD);
		const c2 = await encrypt(plain, PASSWORD);
		expect(c1).not.toEqual(c2);
	});

	it('rejects wrong password', async () => {
		const plain = new TextEncoder().encode('secret');
		const enc = await encrypt(plain, PASSWORD);
		await expect(decrypt(enc, 'wrong-password')).rejects.toThrow();
	});

	it('rejects tampered ciphertext', async () => {
		const plain = new TextEncoder().encode('secret');
		const enc = await encrypt(plain, PASSWORD);
		enc[enc.length - 1] ^= 0xff; // flip a byte in the tag
		await expect(decrypt(enc, PASSWORD)).rejects.toThrow();
	});
});
