// A small zip writer and reader with no dependencies (the browser's CompressionStream does the deflate).
//
// Writer: stored or deflate entries, UTF-8 names, sizes known up front (no data descriptors), no zip64. Photos are stored (JPEG does not compress).
// Reader: reads the CENTRAL DIRECTORY (the list at the end of the file) and takes each entry by its exact offset. Stage 1 showed that scanning a zip
// from the front for entry markers misreads some stored JPEGs, so this is the only reader. It treats the file as hostile:
//   - refuses: not a zip, truncated, zip64, several disks, encrypted entries, methods other than stored/deflate, overlapping entries, entries that
//     start inside the central directory, names with "..", absolute paths, backslashes, drive letters, control characters, duplicates;
//   - limits: number of entries, size of each entry (checked against the declared size AND while inflating), total unpacked size;
//   - every entry's CRC-32 and size are checked when it is read.

export class ZipError extends Error { constructor(m) { super(m); this.name = "ZipError"; } }

export const DEFAULT_LIMITS = { maxEntries: 20000, maxEntryBytes: 60 * 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 * 1024, maxNameBytes: 200 };

// ---------------------------------------------------------------- CRC-32
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

// ---------------------------------------------------------------- deflate through the platform streams
async function through(bytes, transform, maxOut = Infinity) {
  const writer = transform.writable.getWriter();
  const writing = writer.write(bytes).then(() => writer.close());
  writing.catch(() => {});
  const reader = transform.readable.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxOut) { await reader.cancel().catch(() => {}); throw new ZipError("An entry unpacks to more than its declared size (damaged or hostile file)."); }
      chunks.push(value);
    }
    await writing;
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError("An entry could not be unpacked (damaged file).");
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
export const deflateRaw = (bytes) => through(bytes, new CompressionStream("deflate-raw"));
export const inflateRaw = (bytes, maxOut) => through(bytes, new DecompressionStream("deflate-raw"), maxOut);

// ---------------------------------------------------------------- name rules (used by the writer too, so we never write what we would refuse)
export function checkName(name, maxNameBytes = DEFAULT_LIMITS.maxNameBytes) {
  const bytes = new TextEncoder().encode(name).length;
  if (!name || bytes > maxNameBytes) throw new ZipError("A file name in the zip is empty or too long.");
  if (/[\u0000-\u001f\u007f\\]/.test(name)) throw new ZipError("A file name in the zip has a backslash or a control character.");
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw new ZipError("A file name in the zip is an absolute path.");
  if (name.split("/").some((p) => p === ".." || p === ".")) throw new ZipError("A file name in the zip contains a '..' path.");
  if (name.endsWith("/")) throw new ZipError("The zip contains a folder entry, which this app does not use.");
}

// ---------------------------------------------------------------- writer
const u16 = (v, n, o) => { v[o] = n & 255; v[o + 1] = (n >>> 8) & 255; };
const u32 = (v, n, o) => { v[o] = n & 255; v[o + 1] = (n >>> 8) & 255; v[o + 2] = (n >>> 16) & 255; v[o + 3] = (n >>> 24) & 255; };

function dosDateTime(ms) {
  const d = new Date(ms);
  const year = Math.max(1980, d.getUTCFullYear());
  return { time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1), date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate() };
}

export class ZipWriter {
  constructor({ timeMs = Date.now() } = {}) { this.parts = []; this.offset = 0; this.entries = []; this.names = new Set(); this.dt = dosDateTime(timeMs); this.encoder = new TextEncoder(); }

  /** data: Uint8Array. compress: deflate it (text) or store it (photos). */
  async add(name, data, { compress = false } = {}) {
    checkName(name);
    if (this.names.has(name)) throw new ZipError("Two entries have the same name: " + name);
    if (data.length > 0xfffffffe || this.entries.length >= 0xfffe) throw new ZipError("The file is too large for a simple zip.");
    this.names.add(name);
    const crc = crc32(data);
    let body = data, method = 0;
    if (compress && data.length > 64) { const d = await deflateRaw(data); if (d.length < data.length) { body = d; method = 8; } }
    const nameBytes = this.encoder.encode(name);
    const h = new Uint8Array(30);
    u32(h, 0x04034b50, 0); u16(h, 20, 4); u16(h, 0x0800, 6); u16(h, method, 8); u16(h, this.dt.time, 10); u16(h, this.dt.date, 12);
    u32(h, crc, 14); u32(h, body.length, 18); u32(h, data.length, 22); u16(h, nameBytes.length, 26); u16(h, 0, 28);
    this.entries.push({ nameBytes, method, crc, csize: body.length, usize: data.length, offset: this.offset });
    this.parts.push(h, nameBytes, body);
    this.offset += 30 + nameBytes.length + body.length;
    if (this.offset > 0xfffffffe) throw new ZipError("The file is too large for a simple zip.");
  }

  finish() {
    const cdStart = this.offset;
    let cdSize = 0;
    for (const e of this.entries) {
      const c = new Uint8Array(46);
      u32(c, 0x02014b50, 0); u16(c, 20, 4); u16(c, 20, 6); u16(c, 0x0800, 8); u16(c, e.method, 10); u16(c, this.dt.time, 12); u16(c, this.dt.date, 14);
      u32(c, e.crc, 16); u32(c, e.csize, 20); u32(c, e.usize, 24); u16(c, e.nameBytes.length, 28); u32(c, e.offset, 42);
      this.parts.push(c, e.nameBytes);
      cdSize += 46 + e.nameBytes.length;
    }
    const end = new Uint8Array(22);
    u32(end, 0x06054b50, 0); u16(end, this.entries.length, 8); u16(end, this.entries.length, 10); u32(end, cdSize, 12); u32(end, cdStart, 16);
    this.parts.push(end);
    return new Blob(this.parts, { type: "application/zip" });
  }
}

// ---------------------------------------------------------------- reader
const rd16 = (v, o) => v[o] | (v[o + 1] << 8);
const rd32 = (v, o) => (v[o] | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24)) >>> 0;
const slice = async (blob, a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer());

/** source: a Blob or File (in Node: a Blob, or `new Blob([uint8array])`). Returns { entries: Map(name -> info), names, read(name) }. */
export async function openZip(source, limits = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const size = source.size;
  if (size < 22) throw new ZipError("This is not a sync file (too small to be a zip).");
  const tailLen = Math.min(size, 22 + 65535);
  const tail = await slice(source, size - tailLen, size);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (rd32(tail, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError("This is not a complete sync file (the end of the zip is missing: the file may be cut off).");
  const disk = rd16(tail, eocd + 4), cdDisk = rd16(tail, eocd + 6), nHere = rd16(tail, eocd + 8), n = rd16(tail, eocd + 10);
  const cdSize = rd32(tail, eocd + 12), cdOffset = rd32(tail, eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || nHere !== n) throw new ZipError("Zips in several parts are not supported.");
  if (n === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError("This zip uses zip64, which sync files do not.");
  if (n > L.maxEntries) throw new ZipError(`The zip has ${n} entries; the limit is ${L.maxEntries}.`);
  const eocdPos = size - tailLen + eocd;
  if (cdOffset + cdSize > eocdPos) throw new ZipError("The zip's index points outside the file (damaged or cut off).");
  const cd = await slice(source, cdOffset, cdOffset + cdSize);
  const dec = new TextDecoder("utf-8", { fatal: true });
  const entries = new Map();
  let at = 0, total = 0;
  for (let i = 0; i < n; i++) {
    if (at + 46 > cd.length || rd32(cd, at) !== 0x02014b50) throw new ZipError("The zip's index is damaged.");
    const flags = rd16(cd, at + 8), method = rd16(cd, at + 10), crc = rd32(cd, at + 16), csize = rd32(cd, at + 20), usize = rd32(cd, at + 24);
    const nlen = rd16(cd, at + 28), elen = rd16(cd, at + 30), clen = rd16(cd, at + 32), offset = rd32(cd, at + 42);
    if (at + 46 + nlen + elen + clen > cd.length) throw new ZipError("The zip's index is damaged.");
    let name;
    try { name = dec.decode(cd.subarray(at + 46, at + 46 + nlen)); } catch (_) { throw new ZipError("A file name in the zip is not valid text."); }
    at += 46 + nlen + elen + clen;
    checkName(name, L.maxNameBytes);
    if (entries.has(name)) throw new ZipError("The zip lists the same name twice: " + name);
    if (flags & 1) throw new ZipError("The zip is encrypted by the zip format; sync files use the app's own passphrase option instead.");
    if (method !== 0 && method !== 8) throw new ZipError("The zip uses a compression method this app does not read.");
    if (csize === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff) throw new ZipError("This zip uses zip64, which sync files do not.");
    if (usize > L.maxEntryBytes) throw new ZipError(`The entry ${name} is larger than the limit (${Math.round(L.maxEntryBytes / 1048576)} MB).`);
    if (method === 0 && csize !== usize) throw new ZipError("A stored entry has two different sizes (damaged file).");
    total += usize;
    if (total > L.maxTotalBytes) throw new ZipError("The zip unpacks to more than the total size limit.");
    entries.set(name, { name, method, crc, csize, usize, offset, start: -1 });
  }
  // where each entry's data starts, and that no two entries overlap or reach into the index
  const list = [...entries.values()];
  for (const e of list) {
    if (e.offset + 30 > cdOffset) throw new ZipError("An entry starts outside the file body (damaged file).");
    const lh = await slice(source, e.offset, e.offset + 30);
    if (rd32(lh, 0) !== 0x04034b50) throw new ZipError("An entry's header is damaged.");
    e.start = e.offset + 30 + rd16(lh, 26) + rd16(lh, 28);
    if (e.start + e.csize > cdOffset) throw new ZipError("An entry reaches into the zip's index (damaged or hostile file).");
  }
  const sorted = [...list].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].offset < sorted[i - 1].start + sorted[i - 1].csize) throw new ZipError("Two entries overlap (damaged or hostile file).");

  return {
    entries,
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    size: (name) => (entries.get(name) || {}).usize,
    async read(name) {
      const e = entries.get(name);
      if (!e) throw new ZipError("The zip has no entry " + name);
      const raw = await slice(source, e.start, e.start + e.csize);
      const out = e.method === 0 ? raw : await inflateRaw(raw, e.usize);
      if (out.length !== e.usize) throw new ZipError(`The entry ${name} has the wrong size (damaged file).`);
      if (crc32(out) !== e.crc) throw new ZipError(`The entry ${name} fails its checksum (damaged file).`);
      return out;
    },
  };
}
