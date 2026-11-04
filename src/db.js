// 存储后端抽象：Tauri 桌面端用 SQLite 本地数据库，浏览器用 localStorage。
// 整个应用状态以 JSON 存在一行里（kv 表），换库时不动上层逻辑。
const isTauri = !!window.__TAURI_INTERNALS__;
let db = null; // SQLite Database 实例（仅 Tauri）
let mode = "localStorage";

export function backendMode() {
  return mode;
}

export async function initBackend() {
  if (!isTauri) {
    mode = "localStorage";
    return mode;
  }
  try {
    const { default: Database } = await import("@tauri-apps/plugin-sql");
    db = await Database.load("sqlite:notes.db");
    await db.execute(
      "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)"
    );
    mode = "sqlite";
  } catch (e) {
    console.error("[db] SQLite 初始化失败，回退 localStorage：", e);
    db = null;
    mode = "localStorage";
  }
  return mode;
}

export async function loadRaw(key) {
  if (db) {
    const rows = await db.select("SELECT v FROM kv WHERE k = ?", [key]);
    return rows && rows.length ? rows[0].v : null;
  }
  return localStorage.getItem(key);
}

export async function saveRaw(key, value) {
  if (db) {
    await db.execute(
      "INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = ?",
      [key, value, value]
    );
    return;
  }
  localStorage.setItem(key, value);
}

// 读取旧的 localStorage 数据（用于迁移到 SQLite）
export function readLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
