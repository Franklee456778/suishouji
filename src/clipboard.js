// 剪贴板读写：Tauri 用原生插件（WKWebView 限制 navigator.clipboard），浏览器回退。
const isTauri = !!window.__TAURI_INTERNALS__;

export async function writeClipboardText(text) {
  if (isTauri) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    } catch (e) {
      console.warn("[clipboard] 原生写入失败", e);
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function readClipboardText() {
  if (isTauri) {
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return await readText();
    } catch (e) {
      console.warn("[clipboard] 原生读取失败", e);
    }
  }
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
