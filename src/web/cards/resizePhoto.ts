/**
 * Shrinks a camera photo before upload: the longest side becomes 2000 px (JPEG ~0.82), so a
 * 5–12 MB phone photo becomes ~0.4–0.8 MB, quick on mobile data and light on Drive. Also makes a
 * 320 px thumbnail for the card. iPhone HEIC photos decode in Safari and come out as JPEG.
 */
const FULL = 2000;
const THUMB = 320;

async function draw(bitmap: ImageBitmap, max: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read this photo."))), "image/jpeg", quality),
  );
}

export async function resizePhoto(file: File): Promise<{ photo: Blob; thumb: Blob }> {
  // imageOrientation keeps portrait phone photos upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    return { photo: await draw(bitmap, FULL, 0.82), thumb: await draw(bitmap, THUMB, 0.7) };
  } finally {
    bitmap.close();
  }
}
