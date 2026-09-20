import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// Capture once so a repeatedly overwritten screenshot (latest-frame.bmp) does
// not change underneath either the vision request or its saved tool preview.
export async function snapshotAnalysisVisual(workspaceRoot: string, filePath: string) {
  let bytes = await fs.readFile(filePath);
  let extension = path.extname(filePath).toLowerCase();
  // Vita's RGB565 bridge exports BMP. Vision APIs accept PNG; lossless PNG
  // also avoids sending the much larger uncompressed bitmap on every turn.
  if (extension === '.bmp') {
    const { default: Jimp } = await import('jimp');
    bytes = await (await Jimp.read(bytes)).getBufferAsync(Jimp.MIME_PNG);
    extension = '.png';
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  const directory = path.join(workspaceRoot, 'downloads', 'media-analysis-previews');
  const snapshotPath = path.join(directory, `${hash}${extension}`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(snapshotPath, bytes, { flag: 'wx' });
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
  }
  return {
    bytes,
    path: snapshotPath,
    rel_path: path.relative(workspaceRoot, snapshotPath).replace(/\\/g, '/'),
  };
}
