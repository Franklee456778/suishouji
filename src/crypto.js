// 笔记加密：PBKDF2 派生密钥 + AES-GCM。密码绝不存盘。
const enc = new TextEncoder();
const dec = new TextDecoder();
const VERIFY_TOKEN = "IDEAL_NOTES_UNLOCK_OK";
// 新设的密码用 60 万次（OWASP 对 PBKDF2-SHA256 的建议值），次数随锁一起存盘。
// 老锁没存次数，按当年的 15 万次派生——改了就解不开已加密的笔记，所以老锁永远照旧。
const ITERATIONS = 600000;
const LEGACY_ITERATIONS = 150000;

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function unb64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function randomSalt() {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveKey(password, saltB64, iterations = LEGACY_ITERATIONS) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: unb64(saltB64), iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(obj))
  );
  return { iv: b64(iv), data: b64(ct) };
}

export async function decryptJSON(key, blob) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(blob.iv) },
    key,
    unb64(blob.data)
  );
  return JSON.parse(dec.decode(pt));
}

// 首次设密码：生成 salt + 校验块（用于日后验证密码是否正确）
export async function createLock(password) {
  const salt = randomSalt();
  const key = await deriveKey(password, salt, ITERATIONS);
  const verifier = await encryptJSON(key, VERIFY_TOKEN);
  return { lock: { salt, verifier, iterations: ITERATIONS }, key };
}

// 验证密码：成功返回主密钥，失败返回 null
export async function verifyPassword(password, lock) {
  try {
    const key = await deriveKey(password, lock.salt, lock.iterations || LEGACY_ITERATIONS);
    const token = await decryptJSON(key, lock.verifier);
    return token === VERIFY_TOKEN ? key : null;
  } catch {
    return null;
  }
}
