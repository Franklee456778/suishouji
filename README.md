# 随手记

纯本地、重隐私的 macOS 笔记应用（Tauri 2 + TipTap 3 + SQLite）。

- **不联网**：应用自身不发任何网络请求，运行在 macOS 系统沙盒内，读不到电脑上的其他文件
- **单篇加密**：上锁的笔记连同图片一起加密（PBKDF2-SHA256 60 万次 + AES-GCM-256），可用 Touch ID 解锁，闲置自动锁回
- **按标题折叠**：长笔记一节收成一行，查找时自动展开
- **图片自由排版**：拖动换位、文字环绕、拖角缩放
- **导出 Markdown**：图片一起导出，别的软件也能打开
- **自动备份**：保留最近 7 份快照
- **链接先确认**：点链接先由原生对话框显示完整网址，确认才用浏览器打开

安全设计与审核结果见 [SECURITY_AUDIT.md](SECURITY_AUDIT.md)。

## 构建

需要 Node.js、Rust（stable）和 Xcode 命令行工具，仅支持 macOS。

```bash
npm ci
npm test                      # 前端单元测试
(cd src-tauri && cargo test)  # Rust 单元测试
npx tauri build               # 产物在 src-tauri/target/release/bundle/
```

## 目录

| 位置 | 内容 |
|---|---|
| `src/` | 前端：界面、编辑器、存储、加密、导出 |
| `src/extensions/` | 编辑器扩展：标题折叠、图片缩放、代码块等 |
| `src-tauri/src/lib.rs` | Rust：钥匙串、Touch ID、外链确认、页面跳转拦截 |
| `src-tauri/tauri.conf.json` | 应用配置与 CSP |
| `src-tauri/capabilities/default.json` | 前端可调用的权限清单 |
| `src-tauri/Entitlements.plist` | macOS 沙盒权限 |
| `tests/` | 单元测试 |
