// 打开外部链接：只放行 http/https/mailto。
// 桌面端交给 Rust 的 open_external：由原生对话框请用户确认后才打开。
// 前端没有直接打开网址的权限，否则被注入的脚本能把数据拼进网址，用浏览器带出去。
export const SAFE_URL = /^(https?:\/\/|mailto:)/i;

export async function openExternal(href) {
  if (!SAFE_URL.test(href)) return;
  if (window.__TAURI_INTERNALS__) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_external", { url: href });
    } catch (e) {
      console.error("[opener] 打开失败", e);
    }
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}
