export const USER_PASSWORD = process.env.USER_PASSWORD ?? 'idgaf';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '1234asdf';
export const PORT = parseInt(process.env.PORT ?? '8080', 10);
import { fileURLToPath } from 'url';
export const MUSIC_DIR = process.env.MUSIC_DIR ?? fileURLToPath(new URL('../data/music', import.meta.url));
