// 粘贴网址后显示的链接文字：尽量短，又能看出是哪个网站。完整网址只存在链接里。
// 不联网抓标题（用户 2026-11-01 定）：文字完全从网址本身算出来。
const MAX_LEN = 30;

export function shortLinkText(href) {
  let text;
  try {
    const u = new URL(href);
    // 去掉协议、www、查询串和结尾的斜杠，先解码，中文路径才看得懂
    let path = u.pathname;
    try {
      path = decodeURI(path);
    } catch {}
    text = u.hostname.replace(/^www\./i, "") + path.replace(/\/+$/, "");
  } catch {
    text = href;
  }
  const chars = [...text]; // 按字符截，不把 emoji 切坏
  return chars.length > MAX_LEN ? chars.slice(0, MAX_LEN).join("") + "…" : text;
}
