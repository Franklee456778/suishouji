// 存储层：内存里持有完整 state，读全部同步；写通过 db.js 落到后端
// （Tauri = SQLite 本地库，浏览器 = localStorage）。
import { initBackend, loadRaw, saveRaw, readLocalStorage, backendMode } from "./db.js";
import { MANUAL_VERSION, manualNote } from "./manual.js";

const KEY = "slim-notes-data-v1";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function seed() {
  const fid = uid();
  const now = Date.now();
  return {
    folders: [{ id: fid, name: "我的笔记", parentId: null, createdAt: now }],
    notes: [
      {
        id: uid(),
        folderId: fid,
        title: "欢迎使用随手记",
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "这是随手记，支持：" },
              ],
            },
            {
              type: "taskList",
              content: [
                taskItem("表格、待办、代码块", false),
                taskItem("图片拖拽缩放", false),
                taskItem("字体大小 / 行距调节", false),
                taskItem("亮 / 暗主题切换", true),
              ],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "试试上面工具栏的各个按钮 👆" }],
            },
          ],
        },
        createdAt: now,
        updatedAt: now,
        locked: false,
      },
    ],
    settings: {
      theme: "system",
      fontSize: 16,
      lineHeight: 1.75,
      paper: "classic",
      noteSort: "edited", // edited | created | name
      folderSort: "created", // created | name
      collapsedFolders: [], // 折叠起来的文件夹 id（存"折叠"而非"展开"，新建的默认展开）
      lock: null, // 应用锁：{ salt, verifier }，设密码后写入；密码本身不存
    },
  };
}

function taskItem(text, checked) {
  return {
    type: "taskItem",
    attrs: { checked },
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

let state = null;

// 启动时调用：初始化后端 + 载入（或迁移/播种）数据。必须先 await 再用 store。
export async function initStore() {
  const m = await initBackend();
  let raw = await loadRaw(KEY);
  // 首次进 SQLite 且库为空时，把旧的 localStorage 数据迁移过来
  if (!raw && m === "sqlite") {
    const legacy = readLocalStorage(KEY);
    if (legacy) {
      raw = legacy;
      await saveRaw(KEY, legacy);
      console.info("[store] 已将 localStorage 数据迁移到 SQLite");
    }
  }
  if (raw) {
    try {
      state = migrate(JSON.parse(raw));
    } catch {
      state = seed();
    }
  } else {
    state = seed();
  }
  ensureManual(); // 注入/更新「使用说明」笔记
  await saveRaw(KEY, JSON.stringify(state)); // 确保后端有一份
  console.info("[store] 后端：" + backendMode());
  return state;
}

// 「使用说明」笔记：版本变化时自动（重新）注入，置顶
function ensureManual() {
  if ((state.settings.manualVersion || 0) >= MANUAL_VERSION) return;
  state.notes = state.notes.filter((n) => !n.isManual); // 去掉旧版说明
  const folderId = state.folders[0]?.id || null;
  state.notes.push(manualNote(uid(), folderId));
  state.settings.manualVersion = MANUAL_VERSION;
}

// 兼容旧数据：补齐新增字段
function migrate(s) {
  s.settings = s.settings || {};
  if (!s.settings.noteSort) s.settings.noteSort = "edited";
  if (!s.settings.folderSort) s.settings.folderSort = "created";
  // 旧文件夹无 createdAt：按现有顺序补一个递增时间，保持原排序
  (s.folders || []).forEach((f, i) => {
    if (!f.createdAt) f.createdAt = 1700000000000 + i * 1000;
    // 子文件夹：老数据一律当顶层
    if (f.parentId === undefined) f.parentId = null;
  });
  // 父文件夹被删干净但子文件夹还在（异常数据）→ 提到顶层，避免整棵子树消失
  const ids = new Set((s.folders || []).map((f) => f.id));
  (s.folders || []).forEach((f) => {
    if (f.parentId && !ids.has(f.parentId)) f.parentId = null;
  });
  if (!Array.isArray(s.settings.collapsedFolders)) s.settings.collapsedFolders = [];
  // 旧的占位"上锁"（locked 但没有真正密文 enc）：当作未锁，正文仍是明文
  (s.notes || []).forEach((n) => {
    if (n.locked && !n.enc) n.locked = false;
  });
  return s;
}

// 写回后端：内存已先更新，落盘异步进行（失败仅记录，不阻塞 UI）
function persist() {
  saveRaw(KEY, JSON.stringify(state)).catch((e) =>
    console.error("[store] 持久化失败：", e)
  );
}

// 排序键：笔记用 title，文件夹用 name
function nameOf(x) {
  return (x.title !== undefined ? x.title || "新笔记" : x.name) || "";
}
function compareBy(a, b, sort) {
  if (sort === "name") return nameOf(a).localeCompare(nameOf(b), "zh-Hans-CN");
  if (sort === "created") return (b.createdAt || 0) - (a.createdAt || 0);
  return (b.updatedAt || 0) - (a.updatedAt || 0); // edited
}

export const store = {
  // 供备份用：拿到当前全部数据的 JSON 快照
  serialize: () => JSON.stringify(state),

  get folders() {
    return state.folders;
  },
  get notes() {
    return state.notes;
  },
  get settings() {
    return state.settings;
  },

  notesInFolder(folderId) {
    const live = state.notes.filter((n) => !n.deletedAt);
    // 选中父文件夹时，子文件夹里的笔记也一并显示——否则笔记都放在子夹里时，
    // 点父夹会是一片空白，很困惑。
    const scope = folderId === "all" ? null : this.descendantIds(folderId);
    const list = scope ? live.filter((n) => scope.has(n.folderId)) : live;
    const sort = state.settings.noteSort || "edited";
    // 置顶始终在最前；同组内按所选方式排
    return [...list].sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      return compareBy(a, b, sort);
    });
  },

  foldersSorted() {
    const sort = state.settings.folderSort || "created";
    return [...state.folders].sort((a, b) => compareBy(a, b, sort));
  },

  /** 某个父下的直接子文件夹（已排序）；parentId 传 null 取顶层 */
  childFolders(parentId = null) {
    const sort = state.settings.folderSort || "created";
    return state.folders
      .filter((f) => (f.parentId || null) === (parentId || null))
      .sort((a, b) => compareBy(a, b, sort));
  },

  /**
   * 整棵树按显示顺序拍平：[{ folder, depth, hasChildren }]
   * 不管折叠——折叠是界面的事，由调用方决定跳过哪些。
   */
  folderTree() {
    const out = [];
    const walk = (parentId, depth) => {
      this.childFolders(parentId).forEach((f) => {
        const kids = this.childFolders(f.id);
        out.push({ folder: f, depth, hasChildren: kids.length > 0 });
        walk(f.id, depth + 1);
      });
    };
    walk(null, 0);
    return out;
  },

  /** 自己 + 所有子孙的 id。用于"看父文件夹要能看到子文件夹里的笔记" */
  descendantIds(id) {
    const out = new Set([id]);
    const walk = (pid) => {
      state.folders.forEach((f) => {
        if ((f.parentId || null) === pid && !out.has(f.id)) {
          out.add(f.id);
          walk(f.id);
        }
      });
    };
    walk(id);
    return out;
  },

  trashedNotes() {
    return state.notes
      .filter((n) => n.deletedAt)
      .sort((a, b) => b.deletedAt - a.deletedAt);
  },

  countInFolder(folderId) {
    const live = state.notes.filter((n) => !n.deletedAt);
    if (folderId === "all") return live.length;
    const scope = this.descendantIds(folderId); // 计数同样含子文件夹
    return live.filter((n) => scope.has(n.folderId)).length;
  },

  countTrash() {
    return state.notes.filter((n) => n.deletedAt).length;
  },

  getNote(id) {
    return state.notes.find((n) => n.id === id);
  },

  addFolder(name, parentId = null) {
    const f = {
      id: uid(),
      name: name || "未命名文件夹",
      parentId: parentId || null,
      createdAt: Date.now(),
    };
    state.folders.push(f);
    persist();
    return f;
  },

  renameFolder(id, name) {
    const f = state.folders.find((x) => x.id === id);
    if (!f || !name) return;
    f.name = name;
    persist();
  },

  // 删除文件夹：连同所有子文件夹一起删；涉及的笔记都移入回收站（可恢复）
  deleteFolder(id) {
    const doomed = this.descendantIds(id);
    state.notes.forEach((n) => {
      if (doomed.has(n.folderId) && !n.deletedAt) {
        n.deletedAt = Date.now();
        n.pinned = false;
      }
    });
    state.folders = state.folders.filter((f) => !doomed.has(f.id));
    state.settings.collapsedFolders = (state.settings.collapsedFolders || []).filter(
      (x) => !doomed.has(x)
    );
    persist();
  },

  /**
   * 移动文件夹到新的父级（null = 顶层）。
   * 拒绝移到自己或自己的子孙下面——那会形成环，整棵子树从树里消失。
   */
  moveFolder(id, newParentId) {
    const f = state.folders.find((x) => x.id === id);
    if (!f) return false;
    const target = newParentId || null;
    if (target === (f.parentId || null)) return false;
    if (target && this.descendantIds(id).has(target)) return false; // 防环
    f.parentId = target;
    persist();
    return true;
  },

  /** 折叠 / 展开（只影响显示，存进 settings 以便重开后保持） */
  toggleFolderCollapsed(id) {
    const list = state.settings.collapsedFolders || (state.settings.collapsedFolders = []);
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else list.push(id);
    persist();
  },
  isFolderCollapsed(id) {
    return (state.settings.collapsedFolders || []).includes(id);
  },

  addNote(folderId) {
    const target =
      folderId === "all" ? state.folders[0]?.id : folderId;
    const n = {
      id: uid(),
      folderId: target,
      title: "",
      doc: { type: "doc", content: [{ type: "paragraph" }] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      locked: false,
      pinned: false,
    };
    state.notes.push(n);
    persist();
    return n;
  },

  togglePin(id) {
    const n = this.getNote(id);
    if (!n) return;
    n.pinned = !n.pinned;
    persist();
  },

  moveNote(id, folderId) {
    const n = this.getNote(id);
    if (!n || folderId === "all") return false;
    if (n.folderId === folderId) return false;
    n.folderId = folderId;
    persist();
    return true;
  },

  updateNote(id, patch) {
    const n = this.getNote(id);
    if (!n) return;
    Object.assign(n, patch, { updatedAt: Date.now() });
    persist();
  },

  // 软删除：移入回收站
  deleteNote(id) {
    const n = this.getNote(id);
    if (!n) return;
    n.deletedAt = Date.now();
    n.pinned = false;
    persist();
  },

  // 从回收站恢复
  restoreNote(id) {
    const n = this.getNote(id);
    if (!n) return;
    n.deletedAt = null;
    persist();
  },

  // 彻底删除
  purgeNote(id) {
    state.notes = state.notes.filter((n) => n.id !== id);
    persist();
  },

  emptyTrash() {
    state.notes = state.notes.filter((n) => !n.deletedAt);
    persist();
  },

  updateSettings(patch) {
    Object.assign(state.settings, patch);
    persist();
  },

  // ---------- 应用锁 ----------
  hasLockPassword() {
    return !!state.settings.lock;
  },
  getLock() {
    return state.settings.lock;
  },
  setLock(lock) {
    state.settings.lock = lock;
    persist();
  },

  // 上锁：存密文，清掉明文 doc
  lockNote(id, encBlob) {
    const n = this.getNote(id);
    if (!n) return;
    n.locked = true;
    n.enc = encBlob;
    n.doc = null;
    n.updatedAt = Date.now();
    persist();
  },
  // 解锁（彻底移除加密）：写回明文 doc
  unlockNote(id, doc) {
    const n = this.getNote(id);
    if (!n) return;
    n.locked = false;
    n.enc = null;
    n.doc = doc;
    n.updatedAt = Date.now();
    persist();
  },
  // 已上锁笔记被编辑后，只更新密文（doc 仍为空）
  updateEncrypted(id, encBlob) {
    const n = this.getNote(id);
    if (!n) return;
    n.enc = encBlob;
    n.updatedAt = Date.now();
    persist();
  },
};
