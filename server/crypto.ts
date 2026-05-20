// AES-256-GCM. Key is derived once per password via PBKDF2 and cached.
// Wire format (all messages): [12-byte IV][ciphertext+16-byte GCM tag]
// Streaming audio wire format: [4B art_len][art?][4B chunk_len][chunk]...[4B:0]

const PBKDF2_ITERATIONS = 100_000;
const FIXED_SALT = new TextEncoder().encode('limp-key-v1');
const IV_LEN = 12;
const AUDIO_CHUNK_SIZE = 128 * 1024; // 128 KB

const keyCache = new Map<string, CryptoKey>();

export async function getKey(password: string): Promise<CryptoKey> {
	if (keyCache.has(password)) return keyCache.get(password)!;
	const raw = new TextEncoder().encode(password);
	const base = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
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

export async function encrypt(plaintext: Uint8Array, password: string): Promise<Uint8Array> {
	const key = await getKey(password);
	const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
	const out = new Uint8Array(IV_LEN + ct.byteLength);
	out.set(iv); out.set(ct, IV_LEN);
	return out;
}

export async function decrypt(data: Uint8Array, password: string): Promise<Uint8Array> {
	const key = await getKey(password);
	const iv = data.slice(0, IV_LEN);
	const ct = data.slice(IV_LEN);
	return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
}

export async function encryptJSON(obj: unknown, password: string): Promise<Uint8Array> {
	return encrypt(new TextEncoder().encode(JSON.stringify(obj)), password);
}

export async function decryptJSON<T>(data: Uint8Array, password: string): Promise<T> {
	return JSON.parse(new TextDecoder().decode(await decrypt(data, password))) as T;
}

// Builds the streaming response body for an audio file + optional art.
// Format: [4B art_len][art bytes?] then repeating [4B chunk_len][chunk] ending with [4B:0]
export async function buildAudioStream(
	audioBytes: Uint8Array,
	artBytes: Uint8Array | null,
	artExt: string,
	password: string
): Promise<ReadableStream<Uint8Array>> {
	const key = await getKey(password);

	async function encryptWithKey(plain: Uint8Array): Promise<Uint8Array> {
		const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
		const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
		const out = new Uint8Array(IV_LEN + ct.byteLength);
		out.set(iv); out.set(ct, IV_LEN);
		return out;
	}

	function u32(n: number): Uint8Array {
		const b = new Uint8Array(4);
		new DataView(b.buffer).setUint32(0, n, false);
		return b;
	}

	return new ReadableStream({
		async start(ctrl) {
			// Art header
			if (artBytes) {
				const artEnc = await encryptWithKey(
					new TextEncoder().encode(JSON.stringify({ artExt, artB64: Buffer.from(artBytes).toString('base64') }))
				);
				ctrl.enqueue(u32(artEnc.byteLength));
				ctrl.enqueue(artEnc);
			} else {
				ctrl.enqueue(u32(0));
			}

			// Audio chunks
			for (let offset = 0; offset < audioBytes.byteLength; offset += AUDIO_CHUNK_SIZE) {
				const slice = audioBytes.slice(offset, offset + AUDIO_CHUNK_SIZE);
				const enc = await encryptWithKey(slice);
				ctrl.enqueue(u32(enc.byteLength));
				ctrl.enqueue(enc);
			}
			ctrl.enqueue(u32(0)); // end sentinel
			ctrl.close();
		}
	});
}
