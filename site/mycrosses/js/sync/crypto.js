// Optional passphrase protection of a sync file (off by default). The whole zip is encrypted in the browser with WebCrypto; nothing leaves the device.
//
// File layout (all numbers big-endian):
//   "HYBENC01"            8 bytes   magic
//   iterations            4 bytes   PBKDF2-SHA-256 rounds (the app writes 600000)
//   salt                  16 bytes  random
//   nonce prefix          8 bytes   random
//   then chunks of up to 1 MiB of plaintext, each: length (4 bytes) + AES-256-GCM ciphertext with its 16-byte tag.
//   Chunk i uses nonce = nonce prefix + i (4 bytes). Its additional authenticated data is the 36 header bytes plus one byte: 1 for the last chunk, else 0,
//   so reordering, cutting off the end, or adding to it makes the check fail. A wrong passphrase fails on the first chunk.

export class CryptoError extends Error { constructor(m) { super(m); this.name = "CryptoError"; } }

const MAGIC = new TextEncoder().encode("HYBENC01");
const HEADER = 8 + 4 + 16 + 8;
const CHUNK = 1024 * 1024;
export const DEFAULT_ITERATIONS = 600000;
const subtle = () => globalThis.crypto.subtle;

const be32 = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const rdBe32 = (v, o) => ((v[o] << 24) | (v[o + 1] << 16) | (v[o + 2] << 8) | v[o + 3]) >>> 0;

async function deriveKey(passphrase, salt, iterations) {
  const base = await subtle().importKey("raw", new TextEncoder().encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const nonceFor = (prefix, i) => { const n = new Uint8Array(12); n.set(prefix, 0); n.set(be32(i), 8); return n; };
const aad = (header, last) => { const a = new Uint8Array(HEADER + 1); a.set(header, 0); a[HEADER] = last ? 1 : 0; return a; };

export async function isEncrypted(blob) {
  if (blob.size < MAGIC.length) return false;
  const head = new Uint8Array(await blob.slice(0, MAGIC.length).arrayBuffer());
  return MAGIC.every((b, i) => head[i] === b);
}

export async function encryptBlob(blob, passphrase, { iterations = DEFAULT_ITERATIONS } = {}) {
  if (typeof passphrase !== "string" || passphrase.length < 1) throw new CryptoError("A passphrase is needed.");
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const prefix = globalThis.crypto.getRandomValues(new Uint8Array(8));
  const header = new Uint8Array(HEADER);
  header.set(MAGIC, 0); header.set(be32(iterations), 8); header.set(salt, 12); header.set(prefix, 28);
  const key = await deriveKey(passphrase, salt, iterations);
  const parts = [header];
  const count = Math.max(1, Math.ceil(blob.size / CHUNK));
  for (let i = 0; i < count; i++) {
    const plain = new Uint8Array(await blob.slice(i * CHUNK, Math.min(blob.size, (i + 1) * CHUNK)).arrayBuffer());
    const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonceFor(prefix, i), additionalData: aad(header, i === count - 1) }, key, plain));
    parts.push(be32(ct.length), ct);
  }
  return new Blob(parts, { type: "application/octet-stream" });
}

export async function decryptBlob(blob, passphrase) {
  if (!(await isEncrypted(blob))) throw new CryptoError("This file is not passphrase-protected.");
  if (blob.size < HEADER + 4 + 16) throw new CryptoError("The protected file is cut off.");
  const header = new Uint8Array(await blob.slice(0, HEADER).arrayBuffer());
  const iterations = rdBe32(header, 8);
  if (iterations < 1000 || iterations > 10000000) throw new CryptoError("The protected file has an unusable setting (damaged file).");
  const key = await deriveKey(String(passphrase || ""), header.slice(12, 28), iterations);
  const prefix = header.slice(28, 36);
  const parts = [];
  let at = HEADER, i = 0;
  for (;;) {
    if (at + 4 > blob.size) throw new CryptoError("The protected file is cut off.");
    const len = rdBe32(new Uint8Array(await blob.slice(at, at + 4).arrayBuffer()), 0);
    if (len < 16 || len > CHUNK + 16 || at + 4 + len > blob.size) throw new CryptoError("The protected file is cut off or damaged.");
    const ct = new Uint8Array(await blob.slice(at + 4, at + 4 + len).arrayBuffer());
    const last = at + 4 + len === blob.size;
    let plain;
    try { plain = new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: nonceFor(prefix, i), additionalData: aad(header, last) }, key, ct)); }
    catch (_) { throw new CryptoError(i === 0 ? "Wrong passphrase, or the file is damaged." : "The protected file is damaged or cut off."); }
    parts.push(plain);
    at += 4 + len; i++;
    if (last) break;
  }
  return new Blob(parts, { type: "application/zip" });
}
