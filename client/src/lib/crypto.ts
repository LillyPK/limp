// Client-side mirror of server/crypto.ts.
// Key is derived from password once via PBKDF2 (100k iterations) and cached.
// Wire format: [12-byte IV][ciphertext+16-byte GCM tag]

const PBKDF2_ITERATIONS = 100_000;
const FIXED_SALT = new TextEncoder().encode('limp-key-v1');
const IV_LEN = 12;

const keyCache = new Map<string, CryptoKey>();

export async function getKey(password: string): Promise<CryptoKey> {
	if (keyCache.has(password)) return keyCache.get(password)!;
	const base = await crypto.subtle.importKey(
		'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
	);
	const key = await crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: FIXED_SALT, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
	keyCache.set(password, key);
	return key;
}

export async function decrypt(data: Uint8Array, password: string): Promise<Uint8Array> {
	const key = await getKey(password);
	const iv = data.slice(0, IV_LEN);
	const ct = data.slice(IV_LEN);
	return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
}

export async function encrypt(plaintext: Uint8Array, password: string): Promise<Uint8Array> {
	const key = await getKey(password);
	const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
	const out = new Uint8Array(IV_LEN + ct.byteLength);
	out.set(iv); out.set(ct, IV_LEN);
	return out;
}

export async function decryptJSON<T>(data: Uint8Array, password: string): Promise<T> {
	return JSON.parse(new TextDecoder().decode(await decrypt(data, password))) as T;
}

export async function encryptJSON(obj: unknown, password: string): Promise<Uint8Array> {
	return encrypt(new TextEncoder().encode(JSON.stringify(obj)), password);
}

// Reads a length-prefixed blob from a buffered stream reader.
// Returns null when a 0-length sentinel is read (end of stream).
export class StreamReader {
	private buf = new Uint8Array(0);
	private reader: ReadableStreamDefaultReader<Uint8Array>;
	private done = false;

	constructor(stream: ReadableStream<Uint8Array>) {
		this.reader = stream.getReader();
	}

	private async fill(need: number) {
		while (this.buf.length < need && !this.done) {
			const { value, done } = await this.reader.read();
			if (done) { this.done = true; break; }
			const next = new Uint8Array(this.buf.length + value.length);
			next.set(this.buf); next.set(value, this.buf.length);
			this.buf = next;
		}
	}

	async readU32(): Promise<number> {
		await this.fill(4);
		if (this.buf.length < 4) throw new Error('stream ended unexpectedly');
		const val = new DataView(this.buf.buffer, this.buf.byteOffset).getUint32(0, false);
		this.buf = this.buf.slice(4);
		return val;
	}

	async readBytes(n: number): Promise<Uint8Array> {
		await this.fill(n);
		if (this.buf.length < n) throw new Error('stream ended unexpectedly');
		const out = this.buf.slice(0, n);
		this.buf = this.buf.slice(n);
		return out;
	}
}
