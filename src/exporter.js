// 导出笔记为 Markdown。
//
// 为什么需要：所有笔记都在一个 SQLite 文件里，加密的忘了密码就永久打不开。
// 能随时导出成 Markdown，内容才真正是你自己的——别的软件也读得了。
//
// 桌面端（Tauri）：让用户选一个文件夹，写 <标题>.md；笔记里有图片时
// 一并写到 <标题>.assets/ 下，正文用相对路径引用。
// 浏览器端：没有文件系统权限，退化成下载单个 .md（图片仍内嵌 data URL）。

import { noteToMarkdown, safeFileName, ASSET_DIR } from "./markdown.js";
import { readImageBytes } from "./imagestore.js";

const isTauri = () => !!window.__TAURI_INTERNALS__;

// base64 → 字节数组（写图片文件用）
function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// 同一目录里重名时加 (2)(3)…，避免互相覆盖
function uniqueName(base, used) {
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base} (${n++})`;
  used.add(name);
  return name;
}

/** 让用户选一个目录；取消返回 null */
async function pickDirectory(title) {
  const { open } = await import("@tauri-apps/plugin-dialog");
  // recursive：对话框会把选中的目录（含子目录）临时加进文件访问范围，导出要在里面建
  // 子文件夹和 .assets 目录。App 的常驻文件权限只有自己的数据目录，不再是整个 $HOME。
  const dir = await open({ directory: true, multiple: false, recursive: true, title });
  return typeof dir === "string" ? dir : null;
}

/** 把一条笔记写进 dir，返回写出的文件名 */
async function writeNoteTo(dir, note, used, fs) {
  const { markdown, images } = noteToMarkdown(note);
  const base = uniqueName(safeFileName(note.title, "未命名笔记"), used);

  await fs.writeTextFile(`${dir}/${base}.md`, markdown);

  if (images.length) {
    const assetDir = `${dir}/${base}.${ASSET_DIR}`;
    await fs.mkdir(assetDir, { recursive: true });
    for (const img of images) {
      // 两种来源：内嵌 base64（加密笔记 / 老数据）和已落盘的图片文件
      const bytes = img.copyFrom
        ? await readImageBytes(img.copyFrom)
        : base64ToBytes(img.base64);
      if (bytes) await fs.writeFile(`${assetDir}/${img.name}`, bytes);
    }
  }
  return `${base}.md`;
}

// 浏览器兜底：直接下载一个 .md（图片保持内嵌）
function downloadMarkdown(note) {
  const { markdown } = noteToMarkdown(note);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = safeFileName(note.title, "未命名笔记") + ".md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * 导出单条笔记。
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function exportNote(note) {
  if (!note) return { ok: false, message: "没有可导出的笔记" };
  if (note.locked) {
    // 上锁的笔记正文是密文，导出出去也是乱码，不如明说
    return { ok: false, message: "加密笔记需要先解锁才能导出" };
  }

  if (!isTauri()) {
    downloadMarkdown(note);
    return { ok: true, message: "已下载 Markdown 文件" };
  }

  const dir = await pickDirectory("选择导出位置");
  if (!dir) return { ok: false, message: "" }; // 用户取消，不用提示

  const fs = await import("@tauri-apps/plugin-fs");
  const name = await writeNoteTo(dir, note, new Set(), fs);
  return { ok: true, message: `已导出「${name}」` };
}

/**
 * 批量导出。notes 里已上锁的会被跳过（正文是密文）。
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function exportNotes(notes, folderLabel = "笔记") {
  const exportable = (notes || []).filter((n) => !n.locked && !n.deletedAt);
  const lockedCount = (notes || []).filter((n) => n.locked && !n.deletedAt).length;
  if (!exportable.length) {
    return { ok: false, message: lockedCount ? "这些笔记都已加密，先解锁再导出" : "没有可导出的笔记" };
  }

  if (!isTauri()) {
    exportable.forEach(downloadMarkdown);
    return { ok: true, message: `已下载 ${exportable.length} 个 Markdown 文件` };
  }

  const parent = await pickDirectory(`导出「${folderLabel}」到…`);
  if (!parent) return { ok: false, message: "" };

  const fs = await import("@tauri-apps/plugin-fs");
  // 建一个带日期的子目录，避免把用户选的文件夹搞乱
  const stamp = new Date().toISOString().slice(0, 10);
  const dir = `${parent}/${safeFileName(folderLabel, "笔记")} ${stamp}`;
  await fs.mkdir(dir, { recursive: true });

  const used = new Set();
  for (const note of exportable) await writeNoteTo(dir, note, used, fs);

  const skipped = lockedCount ? `，跳过 ${lockedCount} 条加密笔记` : "";
  return { ok: true, message: `已导出 ${exportable.length} 条到「${dir.split("/").pop()}」${skipped}` };
}
