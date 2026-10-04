/**
 * Reads the text in a dashboard photo, on the phone itself.
 *
 * Tesseract runs in a Web Worker inside the browser: the photo never leaves
 * the device. Its engine and English data (a few MB) are downloaded from the
 * jsDelivr CDN the first time, then cached by the browser. It is loaded only
 * when someone takes a photo, so nobody else pays for it.
 *
 * Dashboards are hard for it — glare, digital segments, light digits on a dark
 * screen — so the photo is cleaned up and read twice, once inverted, and the
 * caller treats what comes back as suggestions to tap, never as the answer.
 */

import type { Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | null = null;

async function reader(): Promise<Worker> {
  workerPromise ??= (async () => {
    const { createWorker, PSM } = await import('tesseract.js');
    const worker = await createWorker('eng');
    await worker.setParameters({
      /*
       * Automatic page layout, and no character whitelist. "Sparse text" mode
       * returned nothing at all on a clean, high-contrast test image, and the
       * whitelist does not help the LSTM engine; the caller already ignores
       * everything that is not a plausible mileage.
       */
      tessedit_pageseg_mode: PSM.AUTO,
    });
    return worker;
  })().catch((error: unknown) => {
    // Let the next photo try again, e.g. after the connection comes back.
    workerPromise = null;
    throw error;
  });
  return workerPromise;
}

/** Every line of text found, from the photo as taken and inverted. */
export async function readPhotoText(file: File): Promise<string[]> {
  const [worker, image] = await Promise.all([reader(), loadImage(file)]);
  const texts: string[] = [];
  for (const invert of [false, true]) {
    const canvas = prepare(image, invert);
    const { data } = await worker.recognize(canvas);
    texts.push(...data.text.split('\n').filter((line) => line.trim() !== ''));
  }
  return texts;
}

async function loadImage(file: File): Promise<ImageBitmap> {
  // `from-image` honours the phone's rotation, so a portrait photo is upright.
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/** Scaled to a size the reader likes, grey, contrast stretched, optionally inverted. */
function prepare(image: ImageBitmap, invert: boolean): HTMLCanvasElement {
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return canvas;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = pixels;
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = grey;
    if (grey < min) min = grey;
    if (grey > max) max = grey;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < data.length; i += 4) {
    let value = ((data[i] - min) / range) * 255;
    if (invert) value = 255 - value;
    data[i] = data[i + 1] = data[i + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}
