# 随手记 1.0.0 安全审核报告

审核日期：2026-11-04　｜　依赖扫描日期：2026-11-01（之后的 1.0.0 只删除了依赖，没有新增）

## 当前结论

可安全直接修复的问题均已修复。以下两项按开发者的决定执行：保留联网权限（WKWebView 在沙盒里没有该权限无法加载页面，不做系统层禁网）；删除遗留的更新签名私钥。签名公证（#15）、密码最短长度（#16）尚未确认，仍为待开发者决定。

当前**没有发现可由未授权外部攻击者直接利用的 Critical 或 High 漏洞**。仍然存在的风险：应用原生层有联网能力，外发只靠 CSP、跳转拦截、禁用 WebRTC、外链原生确认几层挡住；前端被注入时可改写钥匙串里存的密码、可读剪贴板（拿不到密码，数据也带不出去）；未加密笔记与自动备份在应用数据目录里是明文；ad-hoc 签名、未公证。

本报告不证明某台机器上安装的就是这个版本，也不证明分发出去的安装包未被替换。外链确认框与跳转、带图片笔记的导出、Touch ID 在真机上的表现仍为待确认。

**版本指纹**：源码为本仓库 `v1.0.0` 标签对应的提交（与开发者本地快照逐文件一致）；对应安装包 `随手记_1.0.0.dmg` 的 SHA-256 为 `1a6e463f90b4f13c7839bf0c054a51b587ce4961a8006fd73c8406f4ca02a2c4`。同一版本号下可用这两项区分不同构建。

## 一、项目概况

| 项目 | 内容 |
|---|---|
| 应用 | 随手记 1.0.0，标识符 `com.suishouji.notes`，仅 macOS（Apple Silicon） |
| 技术栈 | Tauri 2（Rust）+ Vite + TipTap 3.32（ProseMirror）+ SQLite，前端为纯 JavaScript |
| 依赖 | npm 直接依赖 19 个（生产 16、开发 3）；Rust 直接依赖 13 个 |
| 运行环境 | macOS 系统沙盒 + Hardened Runtime，ad-hoc 签名 |
| 审核范围 | 依赖漏洞、全部前端与 Rust 源码、权限配置、CSP、加密、文件读写、外发路径、密钥、构建产物 |
| 验证方式 | 单元测试（前端 34 项、Rust 2 项）、浏览器回归测试、沙盒内按正式配置运行的探针测试 |
| 工具 | `npm audit`、`cargo audit`、`cargo tree`、OSV.dev、GitHub Advisory Database、WebSearch |
| 不涉及 | 无 CI/CD、浏览器扩展、`.env` 文件 |

## 二、问题汇总

| # | 类别 | 级别 | 位置 | 状态 |
|---|---|---|---|---|
| 1 | 依赖 | High | prosemirror-view 粘贴 XSS（GHSA-c8x8-7fp4-3x9w） | 已修复 |
| 2 | 代码 | High | 文件权限覆盖整个 `$HOME` | 已修复（另加系统沙盒） |
| 3 | 密钥 | High | 更新签名私钥无密码、险些进入版本库 | 已删除 |
| 4 | 代码 | Medium | HTTP 权限允许访问任意网址 | 已修复（联网插件删除） |
| 5 | 代码 | Medium | Touch ID 校验只在前端，脚本可直接取主密码 | 已修复 |
| 6 | 依赖 | Medium | @tiptap/core `__proto__`（GHSA-cp6q-959q-f8rh） | 已修复（升级到 3.32） |
| 7 | 依赖 | 待确认 | rustls / h2 / quinn-proto / webpki-roots 等网络组件漏洞 | 已修复（组件随联网插件移除） |
| 8 | 依赖 | High（实际影响低） | linkify-it、postcss、nanoid、source-map-js、vite | 已修复 |
| 9 | 代码 | Medium | 脚本经页面跳转、新窗口、打开浏览器、WebRTC 外发数据 | 已修复 |
| 10 | 代码 | Medium | PBKDF2 迭代次数偏低 | 已修复（全部密码 60 万次） |
| 11 | 代码 | Low | 图片文件名路径穿越 | 已修复 |
| 12 | 代码 | Low | 网页指定地址让本机请求内网（SSRF） | 已修复（相关代码删除） |
| 13 | 代码 | Low | CSP 写在 meta 且偏宽 | 已修复 |
| 14 | 代码 | Medium | 系统层面无法禁网（WKWebView 需要 `network.client`） | 已接受（开发者决定） |
| 15 | 代码 | Medium | ad-hoc 签名、未公证 | 待开发者决定 |
| 16 | 代码 | Low | 允许 4 位起的纯数字密码 | 待开发者决定 |
| 17 | 代码 | Low | 前端可调 `keychain_set` / `keychain_delete`，被注入时能改写或删除存的密码（读不到） | 建议关注 |
| 18 | 代码 | Low | 前端有读剪贴板权限（外发已被拦） | 建议关注 |
| 19 | 代码 | Low | 未加密笔记与自动备份在数据目录里是明文 | 建议关注 |
| 20 | 依赖 | Low | `cargo audit`：quick-xml 0.39（2 个）、rsa（1 个） | 建议关注（macOS 不编译） |
| 21 | 依赖 | Low | unic-* 共 5 个已停止维护（Tauri 自身引入） | 建议关注（等上游） |

`npm audit`：0 个漏洞。`cargo audit` 的其余警告（glib、zvariant 系列、proc-macro-error、clipboard-win）经依赖树核实只在 Linux / Windows 上编译。

## 三、已修复的问题

- **依赖（#1 #6 #7 #8）**：npm 依赖升级、TipTap 2 → 3.32 后 `npm audit` 为 0。删除联网插件后 reqwest、hyper、rustls、h2 不再参与 macOS 编译。TipTap 3 默认开启的 `trailingNode` 已关闭（会在每篇笔记末尾补空段、改动内容）；链接协议白名单改用 v3 的 `isAllowedUri`。
- **系统沙盒（#2）**：权限仅有 `app-sandbox`、`files.user-selected.read-write`、`network.client`。实测读不到 `~/.zshrc`、`~/.ssh` 等用户文件，不能监听端口。Tauri 文件权限另外只放行应用数据目录；导出时由对话框临时授权用户所选文件夹。
- **密钥（#3）**：私钥已删除并加入 `.gitignore`，核实从未进入版本库、无任何已安装应用信任它，无需轮换。代码、配置、构建产物中无硬编码密钥。
- **联网（#4 #12）**：删除网页元信息抓取模块、前后端 HTTP 插件及其权限。粘贴网址只在本地生成简短链接文字（`src/linktext.js`），不发请求。
- **Touch ID（#5）**：新增 Rust 命令 `biometric_unlock`，指纹验证通过才返回钥匙串密码；删除可被前端直接调用的读钥匙串命令，实测调用返回“命令不存在”。
- **外发路径（#9）**：`on_navigation` 只放行 `tauri://localhost`；`on_new_window` 一律拒绝；前端无打开网址的权限，外链经 Rust `open_external`（协议白名单 http/https/mailto、长度 ≤ 2048、禁止带账号密码）弹原生确认框后才打开；页面脚本运行前删除 WebRTC 接口；关闭 DNS 预解析。实测外部跳转被拦、`window.open` 返回 null、WebRTC 为 undefined、前端直调打开网址被 ACL 拒绝。
- **加密（#10）**：AES-GCM-256、随机 IV 与盐、WebCrypto 实现；新版所有密码按 60 万次 PBKDF2-SHA256 派生。
- **路径穿越（#11）**：读图、删图、导出前校验文件名白名单。
- **CSP（#13）**：写在 `tauri.conf.json`，正式与开发分开。正式规则 `default-src 'none'`，`connect-src` 仅 IPC，`frame-src` / `worker-src` / `object-src` 为 `'none'`，并开启 `freezePrototype`。实测页面联网、外部图片、嵌入外部网页均被拦截。`style-src` 不注入 nonce（否则 ProseMirror 的行内样式失效）。

**审查后未发现问题**：SQL 全部参数化；应用代码无 XSS、无 `eval`，`innerHTML` 均经转义或为固定内容；外链只放行 http / https / mailto；构建产物无开发钩子和 sourcemap。

## 四、需要开发者决定的问题

1. **#15 签名与公证**：建议申请 Apple Developer Program（99 美元/年）后用 Developer ID 签名并公证；或说明为内部工具，保持 ad-hoc 签名。
2. **#14 系统层禁网**：已选保留联网权限。残余风险是原生层能联网（探针直接 TCP 连接成功），但应用代码没有任何联网逻辑，前端也调用不到。要彻底禁网只能改写为原生应用。
3. **#16 密码最短长度**：建议最短 6 位并提示 8 位以上；或保持 4 位只提示。

## 五、剩余风险与后续建议

- 真机待确认：外链确认框与跳转、带图片笔记的导出、Touch ID（测试机上无论是否开沙盒都报告不可用，判断与沙盒无关）。
- #17 #18 仅在 CSP 已被绕过时才有意义；如要求更严，可给 `keychain_set` 加原生确认，或去掉读剪贴板权限。
- #19：敏感内容请加密上锁；整库加密会增加损坏风险，暂不建议。
- 每次打包前运行 `npm audit` 与 `cargo audit`：审核期间 certifi、rustls 都出现过新公告。
