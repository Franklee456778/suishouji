// 图片改成"独立文件 + 引用"，不再把 base64 塞进笔记 JSON。
//
// 为什么要改：原来图片走 readAsDataURL 内嵌进 doc，而整个应用状态又是**一行 JSON**
// 存在 SQLite 里。结果是贴一张 3MB 的图 → base64 膨胀到 ~4MB → 此后**每次自动保存
// 都要把包含这张图的整个库重写一遍**。笔记多了打字会卡，写入中途崩溃还可能损坏全库。
// 改成文件后，笔记 JSON 里只剩一条 `img:xxx.png` 引用，保存重回轻量。
//
// ⚠️ 加密笔记是例外：它的正文在磁盘上是密文，图片要是写成明文文件就等于绕过了加密。
// 所以加密笔记一律保持 base64 内嵌（跟着密文一起加密）；给笔记上锁时，会把已经
// 变成文件的图片**回填成 base64 再删文件**（inlineDocImages）。

const DIR = "images";
const PREFIX = "img:"; // 笔记里存的引用格式：img:<文件名>

const isTauri = () => !!window.__TAURI_INTERNALS__;

let assetBase = null;   // 解析后的 images 目录绝对路径（用于转成可显示的 URL）
let convertSrc = null;  // Tauri 的 convertFileSrc
let inlineMode = false; // true = 当前笔记已加密，图片保持内嵌不落盘

/** 当前笔记是不是加密笔记（加密笔记的图片必须内嵌） */
export function setInlineMode(on) {
  inlineMode = !!on;
}

/** 启动时调用一次：准备好目录和 URL 转换器，之后 resolveImageSrc 才能同步用 */
export async function initImageStore() {
  if (!isTauri()) return;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const { appDataDir } = await import("@tauri-apps/api/path");
    const core = await import("@tauri-apps/api/core");
    if (!(await fs.exists(DIR, { baseDir: fs.BaseDirectory.AppData }))) {
      await fs.mkdir(DIR, { baseDir: fs.BaseDirectory.AppData, recursive: true });
    }
    assetBase = `${await appDataDir()}/${DIR}`;
    convertSrc = core.convertFileSrc;
  } catch (e) {
    console.warn("[imagestore] 初始化失败，图片回退内嵌模式：", e);
    assetBase = null;
  }
}

const ready = () => !!(assetBase && convertSrc);

export const isImageRef = (src) => typeof src === "string" && src.startsWith(PREFIX);
export const refFileName = (src) => (isImageRef(src) ? src.slice(PREFIX.length) : null);

// 图片文件名白名单：只放行本模块自己生成的形状「id.扩展名」（见 saveImage / migrateDocImages）。
// 引用里的文件名会被直接拼进磁盘路径，不校验的话 `img:../../.ssh/id_rsa` 这种引用
// 就能让读图、导出、删图越出 images 目录。
// 只在真正碰磁盘的地方用；collectRefs 故意不过滤——否则清理孤儿时会把
// 正常文件误判成没人引用而删掉。
const SAFE_NAME = /^[0-9a-z]+\.[0-9a-z+.-]+$/i;
export const isSafeImageName = (name) =>
  typeof name === "string" && SAFE_NAME.test(name) && !name.includes("..");

/**
 * 把笔记里存的 src 转成能显示的 URL。NodeView 渲染时同步调用。
 * 非引用（data: / http:）原样返回。
 */
export function resolveImageSrc(src) {
  if (!isImageRef(src)) return src;
  if (!ready()) return ""; // 还没初始化好：先空着，避免把 img: 当成相对路径请求
  const name = refFileName(src);
  if (!isSafeImageName(name)) return "";
  return convertSrc(`${assetBase}/${name}`);
}

function extFromType(type) {
  const t = (type || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  if (t.includes("gif")) return "gif";
  if (t.includes("webp")) return "webp";
  if (t.includes("svg")) return "svg";
  if (t.includes("heic")) return "heic";
  if (t.includes("avif")) return "avif";
  return "png";
}

const newId = () =>
  (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, "");

function bytesFromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 存一张图。返回要写进笔记的 src：
 * 桌面端且非加密笔记 → `img:xxx.png`；其余情况 → data URL（内嵌）。
 */
export async function saveImage(file) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  if (inlineMode || !ready()) return dataUrl; // 加密笔记 / 浏览器端：保持内嵌

  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const name = `${newId()}.${extFromType(file.type)}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await fs.writeFile(`${DIR}/${name}`, bytes, { baseDir: fs.BaseDirectory.AppData });
    return PREFIX + name;
  } catch (e) {
    console.warn("[imagestore] 写图片文件失败，退回内嵌：", e);
    return dataUrl; // 宁可内嵌，也不能让用户的图片丢了
  }
}

// 遍历 doc 里所有 image 节点
function eachImage(doc, fn) {
  const walk = (n) => {
    if (n?.type === "image") fn(n);
    (n?.content || []).forEach(walk);
  };
  walk(doc || {});
}

/** 这篇笔记引用了哪些图片文件（用于清理孤儿文件） */
export function collectRefs(doc) {
  const refs = new Set();
  eachImage(doc, (n) => {
    const f = refFileName(n.attrs?.src);
    if (f) refs.add(f);
  });
  return refs;
}

/**
 * 迁移：把 doc 里内嵌的 base64 图片写成文件、src 换成引用。
 * 只用于**未加密**笔记。返回新 doc；没有可迁移的返回 null（调用方就不用存盘）。
 */
export async function migrateDocImages(doc) {
  if (!ready() || inlineMode || !doc) return null;

  const targets = [];
  eachImage(doc, (n) => {
    const src = n.attrs?.src || "";
    if (src.startsWith("data:image/")) targets.push(n);
  });
  if (!targets.length) return null;

  const fs = await import("@tauri-apps/plugin-fs");
  const clone = JSON.parse(JSON.stringify(doc));
  const queue = [];
  eachImage(clone, (n) => {
    if ((n.attrs?.src || "").startsWith("data:image/")) queue.push(n);
  });

  let changed = false;
  for (const node of queue) {
    const m = /^data:image\/([a-z0-9+.-]+);base64,(.*)$/i.exec(node.attrs.src);
    if (!m) continue;
    const ext = m[1].toLowerCase().replace("jpeg", "jpg").replace("svg+xml", "svg");
    const name = `${newId()}.${ext}`;
    try {
      // 先落盘成功，再改引用——顺序反了会把图片弄丢
      await fs.writeFile(`${DIR}/${name}`, bytesFromBase64(m[2]), {
        baseDir: fs.BaseDirectory.AppData,
      });
      node.attrs.src = PREFIX + name;
      changed = true;
    } catch (e) {
      console.warn("[imagestore] 迁移某张图失败，保持内嵌：", e);
    }
  }
  return changed ? clone : null;
}

/**
 * 反向：把文件引用回填成 base64（给笔记上锁时用——加密笔记不能把图片留在明文文件里）。
 * 返回 { doc, files } —— files 是回填后可以删掉的文件名。
 */
export async function inlineDocImages(doc) {
  if (!ready() || !doc) return null;

  const clone = JSON.parse(JSON.stringify(doc));
  const nodes = [];
  eachImage(clone, (n) => {
    if (isImageRef(n.attrs?.src)) nodes.push(n);
  });
  if (!nodes.length) return null;

  const fs = await import("@tauri-apps/plugin-fs");
  const files = [];
  for (const node of nodes) {
    const name = refFileName(node.attrs.src);
    if (!isSafeImageName(name)) continue;
    try {
      const bytes = await fs.readFile(`${DIR}/${name}`, {
        baseDir: fs.BaseDirectory.AppData,
      });
      let bin = "";
      bytes.forEach((b) => (bin += String.fromCharCode(b)));
      const ext = (name.split(".").pop() || "png").replace("jpg", "jpeg");
      node.attrs.src = `data:image/${ext};base64,${btoa(bin)}`;
      files.push(name);
    } catch (e) {
      console.warn("[imagestore] 回填图片失败，该图将保持文件引用：", e);
    }
  }
  return files.length ? { doc: clone, files } : null;
}

/** 读取一张图片文件的字节（导出时要把图片一起写出去） */
export async function readImageBytes(name) {
  if (!ready() || !isSafeImageName(name)) return null;
  const fs = await import("@tauri-apps/plugin-fs");
  return fs.readFile(`${DIR}/${name}`, { baseDir: fs.BaseDirectory.AppData });
}

/** 删文件（回填后清理，或清理孤儿） */
export async function removeImages(names) {
  if (!ready() || !names?.length) return;
  const fs = await import("@tauri-apps/plugin-fs");
  for (const n of names) {
    if (!isSafeImageName(n)) continue;
    try {
      await fs.remove(`${DIR}/${n}`, { baseDir: fs.BaseDirectory.AppData });
    } catch {}
  }
}

/**
 * 清理孤儿图片：没有任何笔记再引用的文件。
 * ⚠️ 必须传入**全部**笔记（含回收站里的），否则会误删还能恢复的笔记的图。
 */
export async function sweepOrphans(allDocs) {
  if (!ready()) return { removed: 0 };
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const used = new Set();
    (allDocs || []).forEach((d) => collectRefs(d).forEach((f) => used.add(f)));

    const entries = await fs.readDir(DIR, { baseDir: fs.BaseDirectory.AppData });
    const orphans = entries.filter((e) => e.isFile && !used.has(e.name)).map((e) => e.name);
    await removeImages(orphans);
    return { removed: orphans.length };
  } catch (e) {
    console.warn("[imagestore] 清理孤儿图片失败：", e);
    return { removed: 0 };
  }
}
