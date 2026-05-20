import { zipSync } from 'fflate';
import { encrypt } from './crypto';
import { extname } from 'path';
import sharp from 'sharp';

export type ArtMode = 'full' | 'none' | 'lq';

const LQ_WIDTH = 200;

export async function packLetf(
	songPath: string,
	artPath: string,
	artMode: ArtMode,
	password: string
): Promise<Uint8Array> {
	const songBytes = await Bun.file(songPath).bytes();
	const songExt = extname(songPath) || '.audio';

	const files: Record<string, Uint8Array> = {
		[`song${songExt}`]: songBytes
	};

	if (artMode !== 'none' && artPath) {
		const artExt = extname(artPath) || '.jpg';
		if (artMode === 'lq') {
			const resized = await sharp(artPath).resize(LQ_WIDTH).toBuffer();
			files[`art${artExt}`] = new Uint8Array(resized);
		} else {
			files[`art${artExt}`] = await Bun.file(artPath).bytes();
		}
	}

	const zipped = zipSync(files, { level: 0 });
	return encrypt(zipped, password);
}
