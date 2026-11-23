// Photo pipeline: a picked or camera photo becomes a 1000 px JPEG plus a 300 px thumbnail, with orientation applied and all
// metadata (EXIF, GPS) dropped, because the pixels are redrawn on a canvas. Runs in the browser only.

async function toJpeg(bitmap, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);                    // transparent PNGs become white, not black
  ctx.imageSmoothingQuality = "high"; ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
  if (!blob) throw new Error("This browser could not convert the photo to JPEG.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h };
}

/** file: a File from an <input type=file>. Returns { full, thumb, width, height } (full and thumb are Uint8Array). */
export async function preparePhoto(file) {
  if (!file || !/^image\//.test(file.type || "image/")) throw new Error("That file is not a picture.");
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (_) { throw new Error("This browser could not read that picture (HEIC photos may need to be shared as JPEG)."); }
  try {
    const full = await toJpeg(bitmap, 1000, 0.82), thumb = await toJpeg(bitmap, 300, 0.78);
    return { full: full.bytes, thumb: thumb.bytes, width: full.width, height: full.height };
  } finally { if (bitmap.close) bitmap.close(); }
}
