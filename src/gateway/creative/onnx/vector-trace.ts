// eslint-disable-next-line @typescript-eslint/no-var-requires
const potrace = require('potrace');
import Jimp from 'jimp';

export type TracedShape = {
  svgPath: string;
  fill: string;
  width: number;
  height: number;
};

export async function traceFlatRegion(crop: Jimp, fill: string): Promise<TracedShape | null> {
  const buffer = await crop.getBufferAsync(Jimp.MIME_PNG);
  const svg: string = await new Promise((resolve, reject) => {
    potrace.trace(
      buffer,
      {
        threshold: 128,
        color: fill,
        background: 'transparent',
        turdSize: 4,
        optTolerance: 0.4,
      },
      (err: any, output: string) => {
        if (err) return reject(err);
        resolve(output);
      },
    );
  });
  if (!svg || typeof svg !== 'string') return null;
  const match = svg.match(/<path[^>]*\sd="([^"]+)"/i);
  if (!match) return null;
  return {
    svgPath: match[1],
    fill,
    width: crop.bitmap.width,
    height: crop.bitmap.height,
  };
}
