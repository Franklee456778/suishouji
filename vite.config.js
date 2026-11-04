import { readFileSync } from "node:fs";

// CSP 只在 src-tauri/tauri.conf.json 里维护一份：正式包由 Tauri 以响应头注入（frame-ancestors
// 这类只在响应头里生效的规则才真正起作用）。浏览器预览（vite dev）没有 Tauri，这里把 devCsp
// 写成 <meta> 补上，让预览和真机用同一套规则——不然在预览里测过的东西到真机可能被 CSP 拦掉。
const conf = JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"));

function cspForMeta(csp) {
  if (typeof csp === "string") return csp;
  return Object.entries(csp)
    .filter(([k]) => k !== "frame-ancestors") // <meta> 里写了也被忽略，还会刷控制台警告
    .map(([k, v]) => `${k} ${[].concat(v).join(" ")}`)
    .join("; ");
}

export default {
  plugins: [
    {
      name: "dev-csp-meta",
      apply: "serve", // 只管预览；出包时 CSP 由 Tauri 注入
      transformIndexHtml() {
        return [
          {
            tag: "meta",
            attrs: { "http-equiv": "Content-Security-Policy", content: cspForMeta(conf.app.security.devCsp) },
            injectTo: "head-prepend",
          },
        ];
      },
    },
  ],
};
