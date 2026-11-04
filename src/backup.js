// 启动时自动备份。
//
// 现状的风险：所有笔记都存在一个 SQLite 文件的一行 JSON 里。这行写坏了，
// 或者文件损坏了，就是全部笔记一起没。所以每天留一份快照，出事至少能回到昨天。
//
// 只在桌面端做（浏览器端没有文件系统）。备份是纯 JSON，不依赖本 App 也能读。

const KEEP = 7;                       // 保留最近 7 份
const MIN_GAP_MS = 12 * 60 * 60 * 1000; // 12 小时内重启不重复备份
const DIR = "backups";
const PREFIX = "notes-";

const isTauri = () => !!window.__TAURI_INTERNALS__;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// 从文件名反解出时间，用来判断最近一次备份有多久了
function timeOf(name) {
  const m = /^notes-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.json$/.exec(name);
  if (!m) return 0;
  const [, y, mo, d, h, mi] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi).getTime();
}

/**
 * 备份当前全部数据。
 * @param {() => string} serialize 返回要落盘的 JSON 字符串
 * @returns {Promise<{done: boolean, reason?: string, file?: string}>}
 */
export async function autoBackup(serialize) {
  if (!isTauri()) return { done: false, reason: "浏览器端不做备份" };

  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const base = fs.BaseDirectory.AppData;

    if (!(await fs.exists(DIR, { baseDir: base }))) {
      await fs.mkdir(DIR, { baseDir: base, recursive: true });
    }

    const entries = await fs.readDir(DIR, { baseDir: base });
    const backups = entries
      .filter((e) => e.isFile && e.name.startsWith(PREFIX) && e.name.endsWith(".json"))
      .map((e) => ({ name: e.name, t: timeOf(e.name) }))
      .sort((a, b) => b.t - a.t);

    // 刚备份过就跳过：频繁重启不该刷掉历史快照
    if (backups.length && Date.now() - backups[0].t < MIN_GAP_MS) {
      return { done: false, reason: "距上次备份不足 12 小时" };
    }

    const file = `${DIR}/${PREFIX}${stamp()}.json`;
    await fs.writeTextFile(file, serialize(), { baseDir: base });

    // 只留最近 KEEP 份，旧的删掉（新写的这份还没在列表里，所以从第 KEEP 份起删）
    for (const old of backups.slice(KEEP - 1)) {
      await fs.remove(`${DIR}/${old.name}`, { baseDir: base });
    }
    return { done: true, file };
  } catch (e) {
    // 备份失败绝不能影响正常使用，记一条日志就算了
    console.warn("[backup] 自动备份失败：", e);
    return { done: false, reason: String(e) };
  }
}

/** 备份目录（给"在访达中显示"之类的入口用） */
export async function backupDir() {
  if (!isTauri()) return null;
  const { appDataDir } = await import("@tauri-apps/api/path");
  return `${await appDataDir()}/${DIR}`;
}
