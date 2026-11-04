import "./styles.css";
import { store, initStore } from "./store.js";
import { TextSelection } from "@tiptap/pm/state";
import { foldedRangesOf } from "./extensions/FoldableHeading.js";
import { createEditor, buildToolbar } from "./editor.js";
import { showPrompt, showConfirm, showPassword } from "./dialog.js";
import { createLock, verifyPassword, encryptJSON, decryptJSON } from "./crypto.js";
import { biometricAvailable, biometricUnlock, keychainSet } from "./biometric.js";
import { readClipboardText } from "./clipboard.js";
import {
  iconAllNotes, iconFolder, iconTrash, iconLock, iconPin, iconChevron,
} from "./icons.js";
import { exportNote, exportNotes } from "./exporter.js";
import { autoBackup } from "./backup.js";
import {
  initImageStore, setInlineMode, saveImage,
  migrateDocImages, inlineDocImages, removeImages, sweepOrphans,
} from "./imagestore.js";

const KC_ACCOUNT = "note-password"; // 钥匙串里存放笔记密码的账户名

const el = (id) => document.getElementById(id);

let currentFolder = "all";
let currentNoteId = null;
let editor = null;
let saveTimer = null;
let searchQuery = "";
let viewKey = null; // 当前正在查看的上锁笔记的密钥；切换笔记即清空

const LH_OPTIONS = [1, 1.25, 1.5, 1.75, 2];

// 纸张配色（亮/暗各一档）——莫兰迪柔雾色系：低饱和、带灰调，耐看不刺眼。
// 亮色不再发白（旧版偏 L98% 太淡），统一压到 L88~92%，更有纸张质感。
const PAPERS = {
  classic: { name: "经典", light: "#faf7ef", dark: "#1a1a1c" }, // 暖白纸
  white: { name: "纯白", light: "#ffffff", dark: "#161618" },
  sand: { name: "米黄", light: "#f1e7d2", dark: "#211d15" }, // 温润奶油
  mustard: { name: "芥末", light: "#eaddba", dark: "#221e12" }, // 柔芥黄
  apricot: { name: "杏", light: "#f4e1c9", dark: "#221a11" }, // 柔杏橘
  bean: { name: "豆沙", light: "#e4cfc9", dark: "#221917" }, // 灰调玫褐
  rose: { name: "暖粉", light: "#f0dbd4", dark: "#221a18" }, // 藕粉
  lilac: { name: "藕荷", light: "#e3dbea", dark: "#1c1a22" }, // 雾紫
  sky: { name: "天青", light: "#d7e3ec", dark: "#161c23" }, // 雾蓝
  slate: { name: "黛蓝", light: "#ccd5df", dark: "#161a20" }, // 沉灰蓝
  lake: { name: "湖水", light: "#cde0da", dark: "#141f1c" }, // 雾青绿
  sage: { name: "护眼", light: "#d8e5cd", dark: "#19201a" }, // 鼠尾草绿
  matcha: { name: "雾松", light: "#cdd6b8", dark: "#1a1e14" }, // 橄榄抹茶
  gray: { name: "浅灰", light: "#e5e3dc", dark: "#202022" }, // 暖灰
};
export const PAPER_LIST = Object.entries(PAPERS).map(([k, v]) => ({ key: k, ...v }));

function isDark() {
  const t = store.settings.theme;
  return (
    t === "dark" ||
    (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

// ---------- 主题 / 行距 / 纸张 ----------
function applyTheme() {
  document.documentElement.setAttribute("data-theme", isDark() ? "dark" : "light");
  applyPaper(); // 纸张色随主题切换
}
function applyLineHeight() {
  document.documentElement.style.setProperty(
    "--editor-line-height",
    store.settings.lineHeight
  );
}
function applyFontSize() {
  document.documentElement.style.setProperty(
    "--editor-font-size",
    (store.settings.fontSize || 16) + "px"
  );
}
const NOTE_PANE_MIN = 200;
const NOTE_PANE_MAX = 560;
function applyNotePaneWidth() {
  let w = Number(store.settings.notePaneWidth) || 280;
  w = Math.max(NOTE_PANE_MIN, Math.min(w, NOTE_PANE_MAX));
  document.documentElement.style.setProperty("--note-pane-w", w + "px");
}
// 中栏右缘拖动调宽（指针事件，WKWebView 可靠）
function setupNotePaneResizer() {
  const pane = el("note-pane");
  if (!pane || pane.querySelector(".col-resizer")) return;
  const handle = document.createElement("div");
  handle.className = "col-resizer";
  handle.title = "拖动调整宽度";
  pane.appendChild(handle);
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    e.stopPropagation();
    const pid = e.pointerId;
    const startX = e.clientX;
    const startW = pane.getBoundingClientRect().width;
    let w = startW;
    handle.classList.add("dragging");
    const onMove = (ev) => {
      w = Math.max(NOTE_PANE_MIN, Math.min(startW + (ev.clientX - startX), NOTE_PANE_MAX));
      document.documentElement.style.setProperty("--note-pane-w", w + "px");
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      try {
        handle.releasePointerCapture(pid);
      } catch {}
      handle.classList.remove("dragging");
      store.updateSettings({ notePaneWidth: Math.round(w) });
    };
    try {
      handle.setPointerCapture(pid);
    } catch {}
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  });
}
function applyPaper() {
  const key = PAPERS[store.settings.paper] ? store.settings.paper : "classic";
  const p = PAPERS[key];
  // 给 CSS 用：纯白纸张时整套界面换成中性灰（见 styles.css 的 data-paper="white"）
  document.documentElement.setAttribute("data-paper", key);
  document.documentElement.style.setProperty(
    "--bg-editor",
    isDark() ? p.dark : p.light
  );
}
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", applyTheme);

// ---------- 左栏 ----------
function renderFolders() {
  const nav = el("folder-list");
  nav.innerHTML = "";

  // depth 用于缩进；chevron 只在有子文件夹时出现
  const mkItem = (id, name, icon, { depth = 0, hasChildren = false, collapsed = false } = {}) => {
    const div = document.createElement("div");
    const active = currentFolder === id;
    div.className = "folder-item" + (active ? " active" : "");
    div.dataset.folderId = id;
    // 缩进按层级；选中态多了 2.5px 左边框，这里减掉，文字才不会横跳
    div.style.paddingLeft = 10 + depth * 14 - (active ? 2.5 : 0) + "px";
    const count = id === "trash" ? store.countTrash() : store.countInFolder(id);

    const twisty = hasChildren
      ? `<span class="folder-twisty${collapsed ? " collapsed" : ""}" title="${
          collapsed ? "展开" : "折叠"
        }">${iconChevron(13)}</span>`
      : `<span class="folder-twisty is-empty"></span>`;

    div.innerHTML =
      twisty +
      `<span class="folder-icon">${icon}</span>` +
      `<span class="folder-name">${escapeHtml(name)}</span>` +
      `<span class="count">${count}</span>`;

    // 点三角只折叠，不切换选中
    const tw = div.querySelector(".folder-twisty");
    if (hasChildren) {
      tw.addEventListener("click", (e) => {
        e.stopPropagation();
        store.toggleFolderCollapsed(id);
        renderFolders();
      });
    }

    div.addEventListener("click", () => {
      currentFolder = id;
      renderFolders();
      renderNotes();
    });
    // 注：接收"拖入的笔记"由 attachNoteDrag 用指针事件+elementFromPoint 完成，
    // 这里不需要 HTML5 的 dragover/drop（原生 DnD 在 WKWebView 不可靠，v0.1.17 已弃用）。
    // "全部笔记"没有重命名/删除，但可以整体导出
    if (id === "all") {
      div.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showAllNotesMenu(e.clientX, e.clientY);
      });
    }
    // 右键：新建子文件夹 / 重命名 / 移动 / 导出 / 删除（仅真实文件夹）
    if (id !== "all" && id !== "trash") {
      div.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showFolderMenu(e.clientX, e.clientY, id, name);
      });
    }
    // 真实文件夹可以拖着换上级（指针事件实现，见 attachFolderDrag）
    if (id !== "all" && id !== "trash") attachFolderDrag(div, id, name);

    nav.appendChild(div);
  };

  mkItem("all", "全部笔记", iconAllNotes(16));

  // 树形展开：遇到折叠的文件夹，就跳过它下面所有更深的层级
  let skipDeeperThan = null;
  store.folderTree().forEach(({ folder, depth, hasChildren }) => {
    if (skipDeeperThan !== null) {
      if (depth > skipDeeperThan) return; // 祖先是折叠状态，整支跳过
      skipDeeperThan = null;
    }
    const collapsed = hasChildren && store.isFolderCollapsed(folder.id);
    mkItem(folder.id, folder.name, iconFolder(16), { depth, hasChildren, collapsed });
    if (collapsed) skipDeeperThan = depth;
  });

  // 回收站
  const sep = document.createElement("div");
  sep.className = "folder-sep";
  nav.appendChild(sep);
  mkItem("trash", "最近删除", iconTrash(16));
}

// ---------- 中栏 ----------
function snippetFromDoc(doc) {
  let text = "";
  const walk = (n) => {
    if (text.length > 60) return;
    if (n.text) text += n.text + " ";
    if (n.type === "linkCard" && n.attrs?.href) text += n.attrs.href + " ";
    (n.content || []).forEach(walk);
  };
  walk(doc || {});
  return text.trim() || "无附加文本";
}

// 全文（用于搜索匹配）
function fullText(doc) {
  let text = "";
  const walk = (n) => {
    if (n.text) text += n.text + " ";
    if (n.type === "linkCard" && n.attrs?.href) text += n.attrs.href + " ";
    (n.content || []).forEach(walk);
  };
  walk(doc || {});
  return text;
}

// 文件扩展名常常恰好也是真实顶级域名（.mov/.app/.zip…），早期 autolink 会把
// "处理背景.mov" 这类文件名误加成链接。打开笔记时清掉这种"纯域名且后缀像文件"的内联链接。
const FILE_EXT_TLD =
  /^(mov|app|zip|dmg|pkg|pdf|png|jpe?g|gif|webp|heic|bmp|svg|tiff?|mp4|m4v|mkv|avi|wmv|flv|mp3|wav|aac|flac|m4a|docx?|xlsx?|pptx?|pages|numbers|key|txt|csv|md|rtf|json|xml|psd|ai|sketch|fig|exe|app)$/i;
function looksLikeFileLink(href) {
  const m = /^https?:\/\/([^/\s?#]+)\/?$/i.exec(href || ""); // 纯域名、无路径
  if (!m) return false;
  const ext = m[1].split(".").pop();
  return FILE_EXT_TLD.test(ext);
}
// 返回清理后的 doc（深拷贝，不改 store 里的对象）；无可清理时返回原对象
function sanitizeDoc(doc) {
  if (!doc || typeof doc !== "object") return doc;
  let changed = false;
  const clone = JSON.parse(JSON.stringify(doc));
  const walk = (n) => {
    if (Array.isArray(n.marks)) {
      let dirty = false;
      const kept = n.marks
        .filter((mk) => {
          const drop = mk.type === "link" && looksLikeFileLink(mk.attrs?.href);
          if (drop) dirty = true;
          return !drop;
        })
        // 早期粘贴留下的行内字号：它会盖过全局字号，同一档字号下这些文字
        // 明显和其它文字不一样大。清掉 fontSize 让它跟随全局设置；
        // mark 上没别的属性了就整条去掉。
        .map((mk) => {
          if (mk.type !== "textStyle" || mk.attrs?.fontSize == null) return mk;
          dirty = true;
          const rest = { ...mk.attrs };
          delete rest.fontSize;
          return Object.keys(rest).length ? { ...mk, attrs: rest } : null;
        })
        .filter(Boolean);
      if (dirty) {
        n.marks = kept;
        changed = true;
      }
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(clone);
  return changed ? clone : doc;
}

// 把命中词高亮（先转义再包 <mark>）
function highlight(text, q) {
  const safe = escapeHtml(text);
  if (!q) return safe;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return safe.replace(re, "<mark>$1</mark>");
}

// 搜索时：若命中在正文深处，给出命中处上下文片段
function searchSnippet(note, q) {
  const base = snippetFromDoc(note.doc);
  if (!q) return escapeHtml(base);
  if (base.toLowerCase().includes(q.toLowerCase())) return highlight(base, q);
  const ft = fullText(note.doc);
  const idx = ft.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return escapeHtml(base);
  const start = Math.max(0, idx - 18);
  const frag = (start > 0 ? "…" : "") + ft.slice(start, idx + q.length + 30).trim() + "…";
  return highlight(frag, q);
}

function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const y = new Date(today - 86400000);
  if (d.toDateString() === y.toDateString()) return "昨天";
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

// 拖着文件夹换上级。
//
// 同样用**指针事件**而不是 HTML5 原生拖放：原生 DnD 在 WKWebView 里不可靠
// （v0.1.17 笔记拖动就是因此重写的）。落点用 elementFromPoint 找。
//
// 合法落点：另一个文件夹（成为它的子级）、或"全部笔记"（=移回顶层）。
// 非法落点不高亮：自己、自己的子孙（会成环，整棵子树消失）、当前的上级（没变化）、回收站。
function attachFolderDrag(div, folderId, folderName) {
  div.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    if (e.target.closest(".folder-twisty")) return; // 点三角是折叠，不是拖动

    const startX = e.clientX;
    const startY = e.clientY;
    const pid = e.pointerId;
    let dragging = false;
    let ghost = null;
    let hover = null;

    const self = store.folders.find((f) => f.id === folderId);
    const banned = store.descendantIds(folderId); // 自己 + 子孙都不能当落点

    // 返回 { el, target } —— target 为 null 表示"移到顶层"
    const dropUnder = (x, y) => {
      if (ghost) ghost.style.display = "none";
      const elx = document.elementFromPoint(x, y);
      if (ghost) ghost.style.display = "";
      const f = elx && elx.closest(".folder-item");
      if (!f) return null;
      const fid = f.dataset.folderId;
      if (fid === "trash") return null;                 // 回收站不是搬家的地方
      if (fid === "all") {
        // 拖到"全部笔记" = 移回顶层；已经在顶层就没意义
        return self && self.parentId ? { el: f, target: null } : null;
      }
      if (banned.has(fid)) return null;                 // 防环
      if ((self?.parentId || null) === fid) return null; // 已经在它下面了
      return { el: f, target: fid };
    };
    const clearHover = () => {
      if (hover) hover.classList.remove("drop-target");
      hover = null;
    };

    const onMove = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        dragging = true;
        document.body.classList.add("note-dragging");
        ghost = document.createElement("div");
        ghost.className = "note-drag-ghost";
        ghost.textContent = folderName;
        document.body.appendChild(ghost);
        try {
          div.setPointerCapture(pid);
        } catch {}
      }
      ev.preventDefault();
      ghost.style.left = ev.clientX + 12 + "px";
      ghost.style.top = ev.clientY + 12 + "px";
      const hit = dropUnder(ev.clientX, ev.clientY);
      if (hit?.el !== hover) {
        clearHover();
        if (hit) {
          hit.el.classList.add("drop-target");
          hover = hit.el;
        }
      }
    };

    const onUp = (ev) => {
      div.removeEventListener("pointermove", onMove);
      div.removeEventListener("pointerup", onUp);
      div.removeEventListener("pointercancel", onUp);
      try {
        div.releasePointerCapture(pid);
      } catch {}
      document.body.classList.remove("note-dragging");
      ghost?.remove();
      if (!dragging) return; // 没达到阈值：当普通点击，交给 click 去选中

      const hit = dropUnder(ev.clientX, ev.clientY);
      clearHover();
      if (hit && store.moveFolder(folderId, hit.target)) {
        // 落进折叠着的文件夹里就展开它，否则搬完看不见
        if (hit.target && store.isFolderCollapsed(hit.target)) {
          store.toggleFolderCollapsed(hit.target);
        }
        renderFolders();
        renderNotes();
      }
      // 抑制拖拽结束后那次误触的 click（否则会顺手切换选中的文件夹）
      const swallow = (ce) => {
        ce.stopPropagation();
        ce.preventDefault();
        div.removeEventListener("click", swallow, true);
      };
      div.addEventListener("click", swallow, true);
      setTimeout(() => div.removeEventListener("click", swallow, true), 350);
    };

    div.addEventListener("pointermove", onMove);
    div.addEventListener("pointerup", onUp);
    div.addEventListener("pointercancel", onUp);
  });
}

// 把笔记拖到左栏文件夹上移动（指针事件实现，WKWebView 可靠）。
// 未达拖动阈值视为普通点击（打开笔记），不影响原有点击行为。
function attachNoteDrag(li, n) {
  li.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    if (e.target.closest(".note-del")) return; // 删除按钮不触发拖拽
    const startX = e.clientX;
    const startY = e.clientY;
    const pid = e.pointerId;
    let dragging = false;
    let ghost = null;
    let hover = null;

    const folderUnder = (x, y) => {
      if (ghost) ghost.style.display = "none";
      const elx = document.elementFromPoint(x, y);
      if (ghost) ghost.style.display = "";
      const f = elx && elx.closest(".folder-item");
      // “全部笔记”不接收移动
      return f && f.dataset.folderId && f.dataset.folderId !== "all" ? f : null;
    };
    const clearHover = () => {
      if (hover) hover.classList.remove("drop-target");
      hover = null;
    };
    const onMove = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        dragging = true;
        document.body.classList.add("note-dragging");
        ghost = document.createElement("div");
        ghost.className = "note-drag-ghost";
        ghost.textContent = n.title || "新笔记";
        document.body.appendChild(ghost);
        try {
          li.setPointerCapture(pid);
        } catch {}
      }
      ev.preventDefault();
      ghost.style.left = ev.clientX + 12 + "px";
      ghost.style.top = ev.clientY + 12 + "px";
      const f = folderUnder(ev.clientX, ev.clientY);
      if (f !== hover) {
        clearHover();
        if (f) {
          f.classList.add("drop-target");
          hover = f;
        }
      }
    };
    const onUp = (ev) => {
      li.removeEventListener("pointermove", onMove);
      li.removeEventListener("pointerup", onUp);
      li.removeEventListener("pointercancel", onUp);
      try {
        li.releasePointerCapture(pid);
      } catch {}
      document.body.classList.remove("note-dragging");
      ghost?.remove();
      if (!dragging) return; // 普通点击：交给 click 监听打开笔记
      const f = folderUnder(ev.clientX, ev.clientY);
      clearHover();
      if (f) {
        const fid = f.dataset.folderId;
        if (fid === "trash") {
          const note = store.getNote(n.id);
          if (note) requestDelete(note);
        } else if (store.moveNote(n.id, fid)) {
          renderFolders();
          renderNotes();
        }
      }
      // 抑制这次拖拽后误触发的 click（避免打开笔记）
      const swallow = (ce) => {
        ce.stopPropagation();
        ce.preventDefault();
        li.removeEventListener("click", swallow, true);
      };
      li.addEventListener("click", swallow, true);
      setTimeout(() => li.removeEventListener("click", swallow, true), 350);
    };
    li.addEventListener("pointermove", onMove);
    li.addEventListener("pointerup", onUp);
    li.addEventListener("pointercancel", onUp);
  });
}

function noteItemEl(n) {
  const li = document.createElement("li");
  li.className = "note-item" + (n.id === currentNoteId ? " active" : "");
  if (!n.deletedAt) attachNoteDrag(li, n); // 指针拖拽到文件夹移动（原生 DnD 在 WKWebView 不可靠）
  const lock = n.locked ? `<span class="lock-icon">${iconLock(13)}</span>` : "";
  const pin = n.pinned ? `<span class="pin-icon">${iconPin(13)}</span>` : "";
  const q = searchQuery.trim();
  const titleHtml = highlight(n.title || "新笔记", q);
  const snippetHtml = n.locked ? "已上锁" : searchSnippet(n, q);
  li.innerHTML = `
    <div class="note-row">
      <div class="note-title">${pin}${lock}${titleHtml}</div>
      <button class="note-del" title="删除">✕</button>
    </div>
    <div class="note-meta">
      <span class="note-date">${fmtDate(n.updatedAt)}</span>
      <span class="note-snippet">${snippetHtml}</span>
    </div>`;
  li.addEventListener("click", (e) => {
    if (e.target.closest(".note-del")) return;
    openNote(n.id);
  });
  li.querySelector(".note-del").addEventListener("click", (e) => {
    e.stopPropagation();
    if (n.deletedAt) requestPurge(n);
    else requestDelete(n);
  });
  li.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, n);
  });
  return li;
}

function renderNotes() {
  const isTrash = currentFolder === "trash";
  el("note-pane-title").textContent = isTrash
    ? "最近删除"
    : currentFolder === "all"
    ? "全部笔记"
    : store.folders.find((f) => f.id === currentFolder)?.name || "笔记";

  // 回收站里把「新建」换成「清空」
  const emptyBtn = el("empty-trash");
  if (emptyBtn) emptyBtn.style.display = isTrash ? "" : "none";
  el("add-note").style.display = isTrash ? "none" : "";

  const ul = el("note-list");
  ul.innerHTML = "";
  const q = searchQuery.trim().toLowerCase();
  let notes = isTrash ? store.trashedNotes() : store.notesInFolder(currentFolder);
  if (q)
    notes = notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        fullText(n.doc).toLowerCase().includes(q)
    );

  if (isTrash) {
    if (notes.length) ul.appendChild(sectionLabel("删除后可恢复"));
    notes.forEach((n) => ul.appendChild(noteItemEl(n)));
  } else {
    const pinned = notes.filter((n) => n.pinned);
    const rest = notes.filter((n) => !n.pinned);
    if (pinned.length) {
      ul.appendChild(sectionLabel("置顶"));
      pinned.forEach((n) => ul.appendChild(noteItemEl(n)));
      if (rest.length) ul.appendChild(sectionLabel("笔记"));
    }
    rest.forEach((n) => ul.appendChild(noteItemEl(n)));
  }

  if (!notes.length) {
    const empty = document.createElement("li");
    empty.className = "note-list-empty";
    empty.textContent = q
      ? "没有匹配的笔记"
      : isTrash
      ? "回收站是空的"
      : "暂无笔记";
    ul.appendChild(empty);
  }
}

function sectionLabel(text) {
  const li = document.createElement("li");
  li.className = "note-section";
  li.textContent = text;
  return li;
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

// ---------- 右键菜单 ----------
function showContextMenu(x, y, note) {
  const menu = el("context-menu");
  menu.innerHTML = "";
  const item = (label, fn, danger) => {
    const d = document.createElement("div");
    d.className = "ctx-item" + (danger ? " ctx-danger" : "");
    d.textContent = label;
    d.addEventListener("click", () => {
      hideContextMenu();
      fn();
    });
    menu.appendChild(d);
  };
  const divider = () => {
    const s = document.createElement("div");
    s.className = "ctx-sep";
    menu.appendChild(s);
  };

  if (note.deletedAt) {
    item("恢复笔记", () => {
      store.restoreNote(note.id);
      renderNotes();
      renderFolders();
    });
    divider();
    item("彻底删除", () => requestPurge(note), true);
  } else {
    item(note.pinned ? "取消置顶" : "置顶笔记", () => {
      store.togglePin(note.id);
      renderNotes();
    });
    item("导出为 Markdown…", async () => {
      const r = await exportNote(store.getNote(note.id));
      if (r.message) showToast(r.message);
    });
    // 已解锁查看中的加密笔记，可移除加密
    if (note.locked && note.id === currentNoteId && viewKey) {
      item("移除加密（变回普通笔记）", () => toolbarHooks.removeEncryption());
    }
    divider();
    item("删除", () => requestDelete(note), true);
  }

  menu.style.left = Math.min(x, window.innerWidth - 170) + "px";
  menu.style.top = y + "px";
  menu.classList.add("open");
}
// 选一个新的父文件夹。排除自己和自己的子孙——移进去会成环，整棵子树会从树里消失。
function showMoveFolderMenu(x, y, folderId, folderName) {
  const menu = el("context-menu");
  menu.innerHTML = "";

  const head = document.createElement("div");
  head.className = "ctx-head";
  head.textContent = `把「${folderName}」移到`;
  menu.appendChild(head);

  const pick = (targetId) => {
    hideContextMenu();
    if (store.moveFolder(folderId, targetId)) {
      if (targetId && store.isFolderCollapsed(targetId)) store.toggleFolderCollapsed(targetId);
      renderFolders();
      renderNotes();
    }
  };

  const row = (label, targetId, depth = 0, disabled = false) => {
    const d = document.createElement("div");
    d.className = "ctx-item" + (disabled ? " ctx-disabled" : "");
    d.style.paddingLeft = 12 + depth * 14 + "px";
    d.textContent = label;
    if (!disabled) d.addEventListener("click", () => pick(targetId));
    menu.appendChild(d);
  };

  const self = store.folders.find((f) => f.id === folderId);
  row("顶层", null, 0, !self?.parentId); // 已经在顶层就置灰

  const banned = store.descendantIds(folderId); // 自己 + 子孙都不能选
  store.folderTree().forEach(({ folder, depth }) => {
    if (banned.has(folder.id)) return;
    row(folder.name, folder.id, depth, (self?.parentId || null) === folder.id);
  });

  menu.style.left = Math.min(x, window.innerWidth - 200) + "px";
  menu.style.top = y + "px";
  menu.classList.add("open");
}

function showAllNotesMenu(x, y) {
  const menu = el("context-menu");
  menu.innerHTML = "";
  const d = document.createElement("div");
  d.className = "ctx-item";
  d.textContent = "导出全部笔记…";
  d.addEventListener("click", async () => {
    hideContextMenu();
    const r = await exportNotes(store.notesInFolder("all"), "全部笔记");
    if (r.message) showToast(r.message);
  });
  menu.appendChild(d);
  menu.style.left = Math.min(x, window.innerWidth - 180) + "px";
  menu.style.top = y + "px";
  menu.classList.add("open");
}

function showFolderMenu(x, y, folderId, folderName) {
  const menu = el("context-menu");
  menu.innerHTML = "";
  const item = (label, fn, danger) => {
    const d = document.createElement("div");
    d.className = "ctx-item" + (danger ? " ctx-danger" : "");
    d.textContent = label;
    d.addEventListener("click", () => {
      hideContextMenu();
      fn();
    });
    menu.appendChild(d);
  };
  item("新建子文件夹…", async () => {
    const name = await showPrompt(`在「${folderName}」下新建子文件夹`, "", "创建");
    if (!name || !name.trim()) return;
    store.addFolder(name.trim(), folderId);
    // 父文件夹如果是折叠的，展开它，否则新建的看不见
    if (store.isFolderCollapsed(folderId)) store.toggleFolderCollapsed(folderId);
    renderFolders();
  });
  item("移到…", () => showMoveFolderMenu(x, y, folderId, folderName));
  const sep0 = document.createElement("div");
  sep0.className = "ctx-sep";
  menu.appendChild(sep0);
  item("导出本文件夹…", async () => {
    const r = await exportNotes(store.notesInFolder(folderId), folderName);
    if (r.message) showToast(r.message);
  });
  item("重命名", async () => {
    const name = await showPrompt("重命名文件夹", folderName, "保存");
    if (name && name.trim()) {
      store.renameFolder(folderId, name.trim());
      renderFolders();
      renderNotes();
    }
  });
  const sep = document.createElement("div");
  sep.className = "ctx-sep";
  menu.appendChild(sep);
  item(
    "删除文件夹",
    async () => {
      const cnt = store.countInFolder(folderId);
      const subCount = store.descendantIds(folderId).size - 1;
      const parts = [];
      if (subCount) parts.push(`连同 ${subCount} 个子文件夹`);
      parts.push(cnt ? `夹内 ${cnt} 条笔记将移入最近删除（可恢复）。` : "这是一个空文件夹。");
      const message = parts.join("，");
      const ok = await showConfirm(`删除「${folderName}」？`, {
        message,
        okLabel: "删除",
        danger: true,
      });
      if (!ok) return;
      store.deleteFolder(folderId);
      if (currentFolder === folderId) currentFolder = "all";
      renderFolders();
      renderNotes();
    },
    true
  );
  menu.style.left = Math.min(x, window.innerWidth - 170) + "px";
  menu.style.top = y + "px";
  menu.classList.add("open");
}

// 通用勾选菜单（用于排序选择）
function showCheckMenu(x, y, items) {
  const menu = el("context-menu");
  menu.innerHTML = "";
  items.forEach((it) => {
    const d = document.createElement("div");
    d.className = "ctx-item ctx-check" + (it.checked ? " checked" : "");
    d.innerHTML = `<span class="ctx-tick">✓</span><span>${escapeHtml(it.label)}</span>`;
    d.addEventListener("click", () => {
      hideContextMenu();
      it.onClick();
    });
    menu.appendChild(d);
  });
  menu.style.left = Math.min(x, window.innerWidth - 180) + "px";
  menu.style.top = y + "px";
  menu.classList.add("open");
}

function hideContextMenu() {
  el("context-menu").classList.remove("open");
}
document.addEventListener("click", hideContextMenu);
document.addEventListener("scroll", hideContextMenu, true);

// 活动检测：有操作就重置自动上锁倒计时（节流 15s）
let lastActivity = 0;
function onActivity() {
  const now = Date.now();
  if (now - lastActivity < 15000) return;
  lastActivity = now;
  if (viewKey) armAutoLock();
}
["mousemove", "mousedown", "keydown"].forEach((ev) =>
  document.addEventListener(ev, onActivity, true)
);

// 普通删除：移入回收站，给撤销机会（不再弹确认框）
function requestDelete(note) {
  store.deleteNote(note.id);
  if (currentNoteId === note.id) closeEditor();
  renderNotes();
  renderFolders();
  showToast(`已删除「${note.title || "新笔记"}」`, "撤销", () => {
    store.restoreNote(note.id);
    renderNotes();
    renderFolders();
  });
}

// 回收站内彻底删除：不可恢复，保留确认
async function requestPurge(note) {
  const ok = await showConfirm(`彻底删除「${note.title || "新笔记"}」？`, {
    message: "此操作无法恢复。",
    okLabel: "彻底删除",
    danger: true,
  });
  if (!ok) return;
  store.purgeNote(note.id);
  if (currentNoteId === note.id) closeEditor();
  renderNotes();
  renderFolders();
}

// ---------- 撤销提示 ----------
let toastTimer = null;
function showToast(msg, actionLabel, actionFn) {
  const t = el("toast");
  t.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = msg;
  t.appendChild(span);
  if (actionLabel) {
    const btn = document.createElement("button");
    btn.className = "toast-btn";
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => {
      actionFn();
      hideToast();
    });
    t.appendChild(btn);
  }
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() {
  el("toast").classList.remove("show");
}

// ---------- 右栏 ----------
function closeEditor() {
  currentNoteId = null;
  viewKey = null;
  hideLockScreen();
  el("empty-state").classList.remove("hidden");
  el("title-input").value = "";
  el("editor-footer").textContent = "";
  el("find-bar").classList.remove("open");
  if (editor) {
    editor.commands.clearSearch();
    editor.commands.clearContent();
  }
}

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

function showLockScreen() {
  // 清空编辑器内容（避免明文残留在 DOM），盖上锁屏
  editor.commands.setContent(EMPTY_DOC, { emitUpdate: false });
  el("lock-err").textContent = "";
  el("lock-pw").value = "";
  el("lock-screen").classList.add("show");
  el("lock-pw").focus();
  // Touch ID 按钮：仅在已启用且设备支持时显示
  const tbtn = el("lock-touchid-btn");
  tbtn.style.display = "none";
  if (store.settings.touchId) {
    biometricAvailable().then((ok) => {
      if (ok && el("lock-screen").classList.contains("show")) tbtn.style.display = "";
    });
  }
}
function hideLockScreen() {
  el("lock-screen").classList.remove("show");
}

// 用密码解开当前笔记：验证→解密→显示。成功 true。
async function unlockWith(password) {
  const note = store.getNote(currentNoteId);
  if (!note || !note.locked) return false;
  const key = await verifyPassword(password, store.getLock());
  if (!key) return false;
  let doc;
  try {
    doc = await decryptJSON(key, note.enc);
  } catch {
    return false;
  }
  viewKey = key;
  setInlineMode(true); // 同上：解锁查看期间新插入的图片也要内嵌
  hideLockScreen();
  editor.commands.setContent(sanitizeDoc(doc) || EMPTY_DOC, { emitUpdate: false });
  editor.commands.focus();
  updateFooter();
  refreshLockButton();
  armAutoLock(); // 解锁后开始计时，离开 5 分钟自动上锁
  return true;
}

// ---------- 自动上锁（闲置 5 分钟）----------
const AUTO_LOCK_MS = 5 * 60 * 1000;
let autoLockTimer = null;
function armAutoLock() {
  clearTimeout(autoLockTimer);
  if (viewKey) autoLockTimer = setTimeout(lockNow, AUTO_LOCK_MS);
}
// 立即上锁：清掉会话密钥（所有加密笔记重新需要密码），当前若是加密笔记则盖锁屏
function lockNow() {
  clearTimeout(autoLockTimer);
  if (!viewKey) return;
  viewKey = null;
  const note = currentNoteId ? store.getNote(currentNoteId) : null;
  if (note && note.locked) showLockScreen();
  refreshLockButton();
}

// 锁屏里输入密码解锁
async function attemptUnlockView() {
  const ok = await unlockWith(el("lock-pw").value);
  if (!ok) {
    el("lock-err").textContent = "密码错误";
    el("lock-pw").select();
  }
}

// Touch ID 解锁：指纹通过 → Rust 端从钥匙串取密码 → 解锁
async function attemptTouchId() {
  el("lock-err").textContent = "";
  const { passed, password: pw } = await biometricUnlock("解锁笔记", KC_ACCOUNT);
  if (!passed) {
    el("lock-err").textContent = "Touch ID 未通过，可改用密码";
    return;
  }
  if (!pw || !(await unlockWith(pw))) {
    el("lock-err").textContent = "无法用 Touch ID 解锁，请用密码";
  }
}

async function openNote(id) {
  const note = store.getNote(id);
  if (!note) return;
  currentNoteId = id;
  el("empty-state").classList.add("hidden");
  el("title-input").value = note.title;
  if (note.locked) {
    setInlineMode(true); // 加密笔记：图片必须跟着密文一起加密，不能落成明文文件
    if (viewKey) {
      // 本次会话已解锁过 → 直接解密显示，不再要密码
      try {
        const doc = await decryptJSON(viewKey, note.enc);
        hideLockScreen();
        editor.commands.setContent(sanitizeDoc(doc) || EMPTY_DOC, { emitUpdate: false });
      } catch {
        showLockScreen();
      }
    } else {
      showLockScreen(); // 尚未解锁本会话 → 锁屏，要密码
    }
  } else {
    hideLockScreen();
    setInlineMode(false); // 普通笔记：图片可以落盘成文件
    let clean = sanitizeDoc(note.doc);
    let dirty = clean && clean !== note.doc;
    // 老笔记里内嵌的 base64 图片，趁打开时迁移成独立文件（写盘成功才改引用）
    const migrated = await migrateDocImages(clean || note.doc);
    if (migrated) {
      clean = migrated;
      dirty = true;
    }
    editor.commands.setContent(clean || EMPTY_DOC, { emitUpdate: false });
    if (dirty) store.updateNote(id, { doc: clean });
  }
  updateFooter();
  renderNotes();
  refreshLockButton();
}

// 触发一次空事务，让工具栏（锁按钮等）刷新状态
function refreshLockButton() {
  if (editor) editor.view.dispatch(editor.state.tr);
}

function updateFooter() {
  if (!currentNoteId || !editor) return;
  const text = editor.getText().replace(/\s/g, "");
  const note = store.getNote(currentNoteId);
  const when = note
    ? new Date(note.updatedAt).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  el("editor-footer").textContent = `${text.length} 字　·　最后编辑 ${when}`;
}

function scheduleSave(patch) {
  if (!currentNoteId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const note = store.getNote(currentNoteId);
    if (!note) return;
    if (patch.doc !== undefined && note.locked) {
      // 上锁笔记：正文只存密文（仅在已解锁查看时才会有编辑）
      if (viewKey) {
        const enc = await encryptJSON(viewKey, patch.doc);
        store.updateEncrypted(currentNoteId, enc);
      }
    } else if (patch.doc !== undefined) {
      store.updateNote(currentNoteId, { doc: patch.doc });
    }
    if (patch.title !== undefined) {
      store.updateNote(currentNoteId, { title: patch.title });
    }
    renderNotes();
    updateFooter();
  }, 400);
}

// ---------- 工具栏回调 ----------
const toolbarHooks = {
  insertImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      // 和粘贴/拖入同一条路：桌面端落盘成文件，加密笔记保持内嵌
      saveImage(file).then((src) => {
        editor.chain().focus().setImage({ src }).run();
      });
    };
    input.click();
  },
  toggleTheme() {
    const order = ["light", "dark", "system"];
    const next = order[(order.indexOf(store.settings.theme) + 1) % order.length];
    store.updateSettings({ theme: next });
    applyTheme();
  },
  setLineHeight(v) {
    store.updateSettings({ lineHeight: Number(v) });
    applyLineHeight();
  },
  getLineHeight() {
    return store.settings.lineHeight;
  },
  setFontSize(v) {
    store.updateSettings({ fontSize: Number(v) });
    applyFontSize();
  },
  getFontSize() {
    return store.settings.fontSize || 16;
  },
  async toggleLock() {
    if (!currentNoteId) return;
    const note = store.getNote(currentNoteId);
    if (!note.locked) {
      // 上锁：取得密钥（首次则设密码）→ 加密正文 → 立刻盖锁屏
      let key = viewKey;
      if (!store.hasLockPassword()) {
        const pw = await showPassword("设置笔记密码", {
          confirm: true,
          message: "用于加密上锁的笔记。建议 8 位以上——纯数字也行，但越短，别人拿到数据文件后越容易猜出来。忘记后无法找回，请牢记。",
          okLabel: "设置",
        });
        if (!pw) return;
        const r = await createLock(pw);
        store.setLock(r.lock);
        key = r.key;
        // 设备支持则询问是否启用 Touch ID（密码存入系统钥匙串）
        if (await biometricAvailable()) {
          const enable = await showConfirm("启用 Touch ID 快速解锁？", {
            message: "开启后可用指纹解锁；密码会安全保存在 macOS 钥匙串。也随时能用密码解锁。",
            okLabel: "启用",
          });
          if (enable && (await keychainSet(KC_ACCOUNT, pw))) {
            store.updateSettings({ touchId: true });
          }
        }
      } else if (!key) {
        const pw = await showPassword("输入笔记密码", { message: "确认是你本人后再加密。" });
        if (pw === null) return;
        key = await verifyPassword(pw, store.getLock());
        if (!key) return showToast("密码错误");
      }
      // 上锁前先把文件引用回填成内嵌 base64，否则图片会以明文文件留在磁盘上，
      // 等于绕过了加密。回填成功后删掉那些文件。
      let plain = editor.getJSON();
      const inlined = await inlineDocImages(plain);
      if (inlined) {
        plain = inlined.doc;
        await removeImages(inlined.files);
      }
      setInlineMode(true);
      const enc = await encryptJSON(key, plain);
      store.lockNote(currentNoteId, enc);
      viewKey = null;
      showLockScreen(); // 立刻隐藏正文
      renderNotes();
      refreshLockButton();
      showToast("已加密上锁");
    } else {
      // 已加密、正在查看中 → 立即上锁（藏回锁屏，保留加密）
      if (!viewKey) return;
      // 先把当前编辑保存为密文，再锁
      const enc = await encryptJSON(viewKey, editor.getJSON());
      store.updateEncrypted(currentNoteId, enc);
      lockNow();
      showToast("已锁定");
    }
  },
  // 移除加密（变回普通笔记）——通过右键菜单触发，需正在解锁查看
  removeEncryption() {
    if (!currentNoteId || !viewKey) return;
    setInlineMode(false); // 变回普通笔记，之后的图片可以落盘
    store.unlockNote(currentNoteId, editor.getJSON());
    renderNotes();
    refreshLockButton();
    showToast("已移除加密");
  },
  isNoteLocked() {
    return currentNoteId ? !!store.getNote(currentNoteId)?.locked : false;
  },
  onSearch(v) {
    searchQuery = v;
    renderNotes();
  },
  papers: PAPER_LIST,
  getPaper() {
    return store.settings.paper || "classic";
  },
  setPaper(key) {
    store.updateSettings({ paper: key });
    applyPaper();
  },
  pastePlain() {
    pastePlainFromClipboard();
  },
};

// ---------- 纯文本粘贴 ----------
function insertPlainText(text) {
  if (!text || !currentNoteId) return;
  const esc = (s) =>
    s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  // 空行分段，段内换行用软换行；只产出 <p>/<br>，不带任何格式
  const html = text
    .split(/\r?\n\r?\n/)
    .map((block) => "<p>" + esc(block).replace(/\r?\n/g, "<br>") + "</p>")
    .join("");
  editor.chain().focus().insertContent(html).run();
}

async function pastePlainFromClipboard() {
  if (!currentNoteId) return;
  const text = await readClipboardText();
  if (text == null) {
    showToast("无法读取剪贴板");
    return;
  }
  insertPlainText(text);
}

// ---------- 事件 ----------
el("add-folder").addEventListener("click", async () => {
  const name = await showPrompt("新建文件夹", "", "创建");
  if (name) {
    store.addFolder(name);
    renderFolders();
  }
});

function newNote() {
  const n = store.addNote(currentFolder);
  renderFolders();
  openNote(n.id);
  el("title-input").focus();
}
el("add-note").addEventListener("click", newNote);

el("title-input").addEventListener("input", (e) =>
  scheduleSave({ title: e.target.value })
);
// 标题按回车 → 跳进正文。若正文第一段是代码块，先在它上面插入一个空段落，
// 光标落在代码块【外面】的普通段落里（否则会直接掉进代码块里出不来）。
el("title-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const first = editor.state.doc.firstChild;
    if (first && first.type.name === "codeBlock") {
      editor.chain().focus().insertContentAt(0, { type: "paragraph" }).run();
    }
    editor.commands.focus("start");
  }
});

// 锁屏解锁
el("lock-unlock-btn").addEventListener("click", attemptUnlockView);
el("lock-touchid-btn").addEventListener("click", attemptTouchId);
el("lock-pw").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    attemptUnlockView();
  }
});

el("toggle-sidebar").addEventListener("click", toggleSidebar);
function toggleSidebar() {
  el("app").classList.toggle("sidebar-collapsed");
}

el("empty-trash").addEventListener("click", async () => {
  const n = store.countTrash();
  if (!n) return;
  const ok = await showConfirm(`清空回收站？`, {
    message: `${n} 条笔记将被彻底删除，无法恢复。`,
    okLabel: "清空",
    danger: true,
  });
  if (!ok) return;
  if (currentNoteId && store.getNote(currentNoteId)?.deletedAt) closeEditor();
  store.emptyTrash();
  renderNotes();
  renderFolders();
});

// 笔记排序菜单
el("sort-notes").addEventListener("click", (e) => {
  e.stopPropagation();
  const cur = store.settings.noteSort || "edited";
  const r = e.currentTarget.getBoundingClientRect();
  const pick = (v) => {
    store.updateSettings({ noteSort: v });
    renderNotes();
  };
  showCheckMenu(r.left, r.bottom + 4, [
    { label: "按编辑时间", checked: cur === "edited", onClick: () => pick("edited") },
    { label: "按创建时间", checked: cur === "created", onClick: () => pick("created") },
    { label: "按名称", checked: cur === "name", onClick: () => pick("name") },
  ]);
});

// 文件夹排序菜单
el("sort-folders").addEventListener("click", (e) => {
  e.stopPropagation();
  const cur = store.settings.folderSort || "created";
  const r = e.currentTarget.getBoundingClientRect();
  const pick = (v) => {
    store.updateSettings({ folderSort: v });
    renderFolders();
  };
  showCheckMenu(r.left - 60, r.bottom + 4, [
    { label: "按创建时间", checked: cur === "created", onClick: () => pick("created") },
    { label: "按名称", checked: cur === "name", onClick: () => pick("name") },
  ]);
});

// 点击正文下方空白处 → 光标落到文末，方便另起一行。
// 若文末正好在某个折叠区里（折叠了最后一节时会这样），直接 focus("end")
// 会把光标送进隐藏内容，"进隐藏区就自动展开"的保护随即把这一节弹开——
// 用户想在折叠区后面接着写却总是把它撑开。这里改成在末尾补一个新段落：
// 它落在折叠范围之外（范围已按折叠时的块数钉死），折叠状态得以保留。
el("editor-scroll").addEventListener("mousedown", (e) => {
  if (!currentNoteId || !editor) return;
  if (e.target.id !== "editor-scroll" && e.target.id !== "editor") return;
  e.preventDefault();

  const { state } = editor;
  const endPos = state.doc.content.size;
  const endInsideFold = foldedRangesOf(state).some(
    (r) => endPos > r.from && endPos <= r.to
  );

  if (endInsideFold) {
    // 末尾在折叠区内：补一个空段落（在折叠范围之外），光标落进去
    editor
      .chain()
      .focus()
      .insertContentAt(endPos, { type: "paragraph" })
      .command(({ tr, dispatch }) => {
        if (dispatch) tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size)));
        return true;
      })
      .run();
    return;
  }
  editor.commands.focus("end"); // 文末不在折叠区里：照常落到文末
});

// ---------- 笔记内查找 ----------
function openFind() {
  if (!currentNoteId || !editor) return;
  el("find-bar").classList.add("open");
  const input = el("find-input");
  input.focus();
  input.select();
  runFind(input.value);
}
function closeFind() {
  el("find-bar").classList.remove("open");
  editor.commands.clearSearch();
}
function runFind(term) {
  editor.commands.setSearchTerm(term);
  updateFindCount();
  scrollToActiveHit();
}
function updateFindCount() {
  const s = editor.storage.searchHighlight;
  const total = s.matches.length;
  el("find-count").textContent = total ? `${s.current + 1}/${total}` : "0/0";
}
function scrollToActiveHit() {
  requestAnimationFrame(() => {
    const hit = document.querySelector(".ProseMirror .search-hit-active");
    if (hit) hit.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}
el("find-input").addEventListener("input", (e) => runFind(e.target.value));
el("find-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    editor.commands.stepSearch(e.shiftKey ? -1 : 1);
    updateFindCount();
    scrollToActiveHit();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeFind();
    editor.commands.focus();
  }
});
el("find-next").addEventListener("click", () => {
  editor.commands.stepSearch(1);
  updateFindCount();
  scrollToActiveHit();
});
el("find-prev").addEventListener("click", () => {
  editor.commands.stepSearch(-1);
  updateFindCount();
  scrollToActiveHit();
});
el("find-close").addEventListener("click", () => {
  closeFind();
  editor.commands.focus();
});

// ---------- 键盘快捷键 ----------
document.addEventListener("keydown", (e) => {
  // Esc：优先关闭查找条
  if (e.key === "Escape" && el("find-bar").classList.contains("open")) {
    closeFind();
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  // ⌘⇧V：纯文本粘贴（去格式）
  if (e.shiftKey && e.key.toLowerCase() === "v") {
    if (currentNoteId && editor?.isFocused) {
      e.preventDefault();
      pastePlainFromClipboard();
    }
    return;
  }
  if (e.shiftKey) return; // 其余带 Shift 的组合不处理
  if (e.key === "n") {
    e.preventDefault();
    newNote();
  } else if (e.key === "f") {
    e.preventDefault();
    // 有笔记打开 → 笔记内查找；否则 → 全局搜索
    if (currentNoteId) openFind();
    else el("toolbar-search")?.focus();
  } else if (e.key === "\\") {
    e.preventDefault();
    toggleSidebar();
  }
});

// ---------- 启动 ----------
(async () => {
  // 先初始化存储后端（SQLite / localStorage）并载入数据
  await initStore();

  // 行距迁移：把旧的非法值归一到最近的可选项
  if (!LH_OPTIONS.includes(Number(store.settings.lineHeight))) {
    store.updateSettings({ lineHeight: 1.5 });
  }
  // 字号迁移：归一到可选项
  if (![14, 16, 18, 20, 24, 28].includes(Number(store.settings.fontSize))) {
    store.updateSettings({ fontSize: 16 });
  }
  // 纸张迁移：旧的 "mint" 已改名 "sage"；已删除的旧 key 归一到经典
  if (store.settings.paper === "mint") {
    store.updateSettings({ paper: "sage" });
  } else if (store.settings.paper && !PAPERS[store.settings.paper]) {
    store.updateSettings({ paper: "classic" });
  }
  // 在 Tauri 桌面端给 <html> 加标记，用于避让红绿灯按钮等原生 chrome
  if (window.__TAURI_INTERNALS__) {
    document.documentElement.classList.add("tauri");
    // 自定义标题栏拖动：用 Tauri 原生 startDragging（-webkit-app-region 在 macOS WKWebView 无效）
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      document.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        // 顶部整条（工具栏 + 两栏标题）空白处都可拖动窗口
        if (!e.target.closest(".toolbar, .pane-header, .find-bar")) return;
        // 只排除真正的交互控件本身（之前误把搜索框的"容器"也排除了，
        // 它占满顶栏中间整片空白，导致大片区域拖不动）
        if (e.target.closest("button, input, select, a, label, .format-popover"))
          return;
        win.startDragging();
      });
    });
  }

  await initImageStore(); // 先备好图片目录，编辑器渲染时才解析得出图片 URL

  applyTheme();
  applyLineHeight();
  applyFontSize();
  applyPaper();
  applyNotePaneWidth();
  setupNotePaneResizer();

  // 编辑器与工具栏常驻（搜索框需要一直可用）
  editor = createEditor(el("editor"), {
    content: { type: "doc", content: [{ type: "paragraph" }] },
    onUpdate: (json) => scheduleSave({ doc: json }),
  });
  buildToolbar(el("toolbar"), editor, toolbarHooks);

  // 仅开发模式：把编辑器挂到 window，方便在浏览器里直接验证行为。
  // import.meta.env.DEV 在 vite build 后是 false，这行会被整段剔除，不会进安装包。
  if (import.meta.env.DEV) {
    window.__editor = editor;
    window.__store = store; // 验证数据层行为时用（HMR 后另开 import 拿到的是别的实例）
  }

  renderFolders();
  renderNotes();
  closeEditor();
  const first = store.notesInFolder("all")[0];
  if (first) openNote(first.id);
  // 启动时自动备份一份（后台做，失败也不影响使用）
  autoBackup(() => store.serialize()).then((r) => {
    if (r.done) console.info("[backup] 已备份到", r.file);
    // 备份之后再清理没人引用的图片文件（传全部笔记，含回收站，避免误删）
    const docs = store.notes.map((n) => n.doc).filter(Boolean);
    return sweepOrphans(docs);
  }).then((r) => {
    if (r?.removed) console.info("[imagestore] 清理孤儿图片", r.removed, "个");
  });

  // App 全程不联网：无更新检查、无任何网络请求。
})();
