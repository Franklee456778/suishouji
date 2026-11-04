// TipTap 3：一律用具名导入。Link、Underline 已并入 StarterKit（在下面 configure 里配置）；
// Placeholder 在 @tiptap/extensions；待办在 @tiptap/extension-list；表格四件套在 @tiptap/extension-table。
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { TextStyle } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { common, createLowlight } from "lowlight";
import { ResizableImage } from "./extensions/ImageResize.js";
import { CodeBlockCopy } from "./extensions/CodeBlockCopy.js";
import { SearchHighlight, searchKey } from "./extensions/SearchHighlight.js";
import { FoldableHeading } from "./extensions/FoldableHeading.js";
import { LinkCard } from "./extensions/LinkCard.js";
import { openExternal } from "./openurl.js";
import { shortLinkText } from "./linktext.js";
import { iconTheme, iconLock, iconSearch, iconFold } from "./icons.js";
import { saveImage } from "./imagestore.js";
import { Selection } from "@tiptap/pm/state";
import { GapCursor } from "@tiptap/pm/gapcursor";

// 待办项：空项按回车 → 跳出待办列表回到普通段落
const ExitableTaskItem = TaskItem.extend({
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { $from } = this.editor.state.selection;
        const para = $from.parent;
        const inTaskItem = $from.node($from.depth - 1)?.type.name === "taskItem";
        if (inTaskItem && para.content.size === 0) {
          return this.editor.chain().focus().liftListItem("taskItem").run();
        }
        return this.editor.commands.splitListItem("taskItem");
      },
    };
  },
});

const lowlight = createLowlight(common);

// 字号是**全局设置**（settings.fontSize → CSS 变量 --editor-font-size），
// v0.1.4 起就不再按选区存 font-size 了。所以这里直接用不带属性的 TextStyle：
// ① 从网页/Word 粘进来的行内 font-size 不会再被解析成 mark。以前会解析，
//    而行内值优先级高于全局 CSS 变量 → 同一档字号下，粘来的文字和原有文字
//    明显不一样大（用户报的就是这个）。
// ② 仍然保留 textStyle 这个 mark 类型：老笔记里存过带 fontSize 的 mark，
//    类型还在才能正常载入（多余的属性会被忽略），删掉类型会直接报错。

// 插入块级原子节点（图片/链接卡片），并把光标停到节点之后：
// 否则节点保持"选中"，下一次粘贴/输入会把它替换掉。
function insertAtomWithGap(editor, content) {
  editor
    .chain()
    .focus()
    .insertContent(content)
    .command(({ tr, dispatch }) => {
      if (!dispatch) return true;
      const $after = tr.doc.resolve(tr.selection.to);
      try {
        tr.setSelection(
          GapCursor.valid($after) ? new GapCursor($after) : Selection.near($after, 1)
        );
      } catch {}
      return true;
    })
    .run();
}

async function insertImageFile(editor, file) {
  // 先探测原图尺寸（用临时 blob URL，不必等落盘）
  const width = await new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      // 默认显示宽度不超过 460px（也不超过原图自身宽度）：
      // 图片不会一进来就占满编辑区，既能往大拖也能往小拖。
      resolve(Math.min(probe.naturalWidth || 460, 460));
      URL.revokeObjectURL(url);
    };
    probe.onerror = () => {
      resolve(460);
      URL.revokeObjectURL(url);
    };
    probe.src = url;
  });

  // 落盘成文件并拿到引用（加密笔记 / 浏览器端会退回 data URL 内嵌）
  const src = await saveImage(file);
  insertAtomWithGap(editor, { type: "image", attrs: { src, width } });
}

export function createEditor(element, { content, onUpdate }) {
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        codeBlock: false, // 用 CodeBlockCopy（带复制按钮和高亮）
        heading: false,   // 交给 FoldableHeading（同名扩展，加了"按标题折叠"）
        // v3 新增、默认开启：会在每篇笔记末尾自动补一个空段落。打开笔记就改动内容 →
        // 编辑时间被刷新、按编辑时间排序乱掉；还会和"折叠区之后继续写"的机制打架。
        trailingNode: false,
        link: {
          // 关掉自动成链：否则像 "处理背景.mov" 这种文件名（.mov/.app/.zip 现在都是真域名）
          // 会被误判成网址加上链接，点开是打不开的空白页。真正的链接走粘贴→标题链接。
          autolink: false,
          linkOnPaste: false,
          openOnClick: false, // 自己处理，避免同窗口跳转
          protocols: ["http", "https", "mailto"],
          // 防注入：只认 http/https/mailto，拒绝 javascript:/data:/file:。
          // v3 里 validate 只管自动成链，挡 XSS 的是 isAllowedUri（解析和渲染链接时都会过一遍）
          isAllowedUri: (url) => /^(https?:\/\/|mailto:)/i.test(url),
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        },
      }),
      FoldableHeading,
      TextStyle,
      Highlight.configure({ multicolor: false }),
      Placeholder.configure({ placeholder: "开始记录…" }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      ExitableTaskItem.configure({ nested: true }),
      CodeBlockCopy.configure({ lowlight }),
      ResizableImage,
      LinkCard,
      SearchHighlight,
    ],
    content,
    editorProps: {
      // 粘贴进来的 HTML 先去掉行内字号/行距：本 App 的字号和行距都是全局设置，
      // 行内值优先级更高，会盖过全局值，表现为"同一档字号下粘来的文字大小不一致"。
      transformPastedHTML(html) {
        return html
          .replace(/font-size\s*:[^;"']*;?/gi, "")
          .replace(/line-height\s*:[^;"']*;?/gi, "");
      },
      handlePaste(view, event) {
        const items = event.clipboardData?.items;
        // 1) 图片
        if (items) {
          for (const item of items) {
            if (item.type.startsWith("image/")) {
              const file = item.getAsFile();
              if (file) {
                insertImageFile(editor, file);
                return true;
              }
            }
          }
        }
        // 2) 纯 URL → 行内短链接：显示简短文字，完整网址存在链接里；不联网
        //    （老笔记里的链接卡片照常显示，只是新粘贴的不再生成卡片）
        const text = event.clipboardData?.getData("text/plain")?.trim();
        if (text && /^https?:\/\/\S+$/i.test(text) && view.state.selection.empty) {
          editor
            .chain()
            .focus()
            .insertContent({ type: "text", text: shortLinkText(text), marks: [{ type: "link", attrs: { href: text } }] })
            .unsetMark("link") // 接着打的字不带链接
            .run();
          return true;
        }
        return false;
      },
      handleDrop(view, event) {
        const files = event.dataTransfer?.files;
        if (!files || !files.length) return false;
        const imgs = [...files].filter((f) => f.type.startsWith("image/"));
        if (!imgs.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (pos) {
          view.dispatch(
            view.state.tr.setSelection(
              view.state.selection.constructor.near(
                view.state.doc.resolve(pos.pos)
              )
            )
          );
        }
        imgs.forEach((f) => insertImageFile(editor, f));
        return true;
      },
    },
    onUpdate: ({ editor }) => onUpdate(editor.getJSON()),
  });

  // 点击行内超链接：仅放行安全协议，统一走 openExternal（Tauri=系统浏览器）。
  editor.view.dom.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a || !a.href || !/^(https?:\/\/|mailto:)/i.test(a.href)) return;
    e.preventDefault();
    openExternal(a.href);
  });

  return editor;
}

// ---------- 工具栏 ----------
export function buildToolbar(container, editor, hooks) {
  container.innerHTML = "";
  const refreshers = [];

  const mkBtn = (label, title, action, isActive) => {
    const b = document.createElement("button");
    b.className = "tb-btn";
    b.innerHTML = label;
    b.title = title;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      action(b);
      refreshAll();
    });
    if (isActive)
      refreshers.push(() => b.classList.toggle("active", isActive()));
    return b;
  };
  const sep = () => {
    const s = document.createElement("span");
    s.className = "tb-sep";
    return s;
  };

  // ===== 「格式」段落样式弹窗 =====
  const formatWrap = document.createElement("div");
  formatWrap.className = "format-wrap";
  const formatBtn = document.createElement("button");
  formatBtn.className = "tb-btn tb-text";
  formatBtn.innerHTML = "格式 ▾";
  formatBtn.title = "段落样式";
  formatBtn.addEventListener("mousedown", (e) => e.preventDefault());
  const popover = buildFormatPopover(editor, refreshers, () => refreshAll(), hooks);
  formatBtn.addEventListener("click", () => {
    popover.classList.toggle("open");
    refreshAll();
  });
  document.addEventListener("mousedown", (e) => {
    if (!formatWrap.contains(e.target)) popover.classList.remove("open");
  });
  formatWrap.appendChild(formatBtn);
  formatWrap.appendChild(popover);
  container.appendChild(formatWrap);
  container.appendChild(sep());

  // ===== 常用行内格式（外置）=====
  container.appendChild(mkBtn("<b>B</b>", "加粗（⌘B）",
    () => editor.chain().focus().toggleBold().run(),
    () => editor.isActive("bold")));
  container.appendChild(mkBtn("<i>I</i>", "斜体（⌘I）",
    () => editor.chain().focus().toggleItalic().run(),
    () => editor.isActive("italic")));
  container.appendChild(mkBtn("<u>U</u>", "下划线（⌘U）",
    () => editor.chain().focus().toggleUnderline().run(),
    () => editor.isActive("underline")));
  container.appendChild(mkBtn("<s>S</s>", "删除线",
    () => editor.chain().focus().toggleStrike().run(),
    () => editor.isActive("strike")));
  container.appendChild(mkBtn(penIcon(), "荧光笔",
    () => editor.chain().focus().toggleHighlight().run(),
    () => editor.isActive("highlight")));
  container.appendChild(mkBtn("&lt;/&gt;", "代码块（带一键复制）",
    () => editor.chain().focus().toggleCodeBlock().run(),
    () => editor.isActive("codeBlock")));
  container.appendChild(sep());

  // ===== 块级插入 =====
  container.appendChild(mkBtn(checklistIcon(), "待办列表",
    () => editor.chain().focus().toggleTaskList().run(),
    () => editor.isActive("taskList")));
  container.appendChild(mkBtn(tableIcon(), "插入表格", () =>
    editor.chain().focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()));
  container.appendChild(mkBtn(imageIcon(), "插入图片（也可直接粘贴/拖拽）",
    () => hooks.insertImage()));

  // 折叠本节：常驻在工具栏，光标所在标题那一节收起/展开。
  // 标题左边虽然也有小三角，但那个不够显眼，用户找不到——工具栏才是大家找功能的地方。
  const foldBtn = mkBtn(iconFold(17), "折叠 / 展开本节（⌘⌥F）",
    () => editor.chain().focus().toggleHeadingFold().run(),
    () => currentSectionFolded(editor));
  container.appendChild(foldBtn);
  refreshers.push(() => {
    // 光标不在任何标题下方时按钮变灰（没东西可折）
    const has = nearestHeading(editor) != null;
    foldBtn.disabled = !has;
    foldBtn.style.opacity = has ? "" : "0.35";
    foldBtn.title = currentSectionFolded(editor)
      ? "展开本节（⌘⌥F）"
      : "折叠本节：把当前标题下的内容收起来（⌘⌥F）";
  });

  // ===== 表格上下文工具 =====
  const tableTools = document.createElement("span");
  tableTools.className = "table-tools";
  const tt = (label, title, fn) =>
    tableTools.appendChild(mkBtn(label, title, () => fn()));
  tt("⊕行", "下方插入行", () => editor.chain().focus().addRowAfter().run());
  tt("⊕列", "右侧插入列", () => editor.chain().focus().addColumnAfter().run());
  tt("⊖行", "删除行", () => editor.chain().focus().deleteRow().run());
  tt("⊖列", "删除列", () => editor.chain().focus().deleteColumn().run());
  tt("✕表", "删除表格", () => editor.chain().focus().deleteTable().run());
  container.appendChild(tableTools);
  refreshers.push(() => {
    tableTools.style.display = editor.isActive("table") ? "inline-flex" : "none";
  });

  // ===== 搜索框（填充顶栏空白，自适应宽度）=====
  const searchWrap = document.createElement("div");
  searchWrap.className = "tb-search-wrap";
  const search = document.createElement("input");
  search.id = "toolbar-search";
  search.className = "tb-search";
  search.type = "text";
  search.placeholder = "搜索全部笔记";
  search.addEventListener("input", () => hooks.onSearch(search.value));
  const searchIcon = document.createElement("span");
  searchIcon.className = "tb-search-icon";
  searchIcon.innerHTML = iconSearch(15);
  searchWrap.appendChild(searchIcon);
  searchWrap.appendChild(search);
  container.appendChild(searchWrap);

  // ===== 主题 + 加密（留在外面）=====
  container.appendChild(mkBtn(iconTheme(17), "切换亮/暗", () => hooks.toggleTheme()));
  const lockBtn = mkBtn(iconLock(17), "加密上锁这条笔记", () => hooks.toggleLock());
  container.appendChild(lockBtn);
  refreshers.push(() => {
    const locked = hooks.isNoteLocked && hooks.isNoteLocked();
    lockBtn.innerHTML = iconLock(17);
    lockBtn.title = locked ? "立即锁定（隐藏内容）" : "加密上锁这条笔记";
  });

  function refreshAll() {
    refreshers.forEach((fn) => fn());
  }
  editor.on("selectionUpdate", refreshAll);
  editor.on("transaction", refreshAll);
  refreshAll();
}

function mkSelect(title, opts, onChange) {
  const sel = document.createElement("select");
  sel.className = "tb-select";
  sel.title = title;
  opts.forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

// ---------- 格式弹窗（段落/块样式 + 排版）----------
function buildFormatPopover(editor, refreshers, refreshAll, hooks) {
  const pop = document.createElement("div");
  pop.className = "format-popover";

  const row = (label, title, action, isActive, sizeCls = "") => {
    const r = document.createElement("button");
    r.className = "fmt-row " + sizeCls;
    r.title = title;
    r.innerHTML = `<span class="fmt-check">✓</span><span class="fmt-label">${label}</span>`;
    r.addEventListener("mousedown", (e) => e.preventDefault());
    r.addEventListener("click", () => {
      action();
      refreshAll();
    });
    refreshers.push(() => r.classList.toggle("checked", isActive()));
    pop.appendChild(r);
    return r;
  };

  row("标题", "标题",
    () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    () => editor.isActive("heading", { level: 1 }), "fmt-h1");
  row("小标题", "小标题",
    () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    () => editor.isActive("heading", { level: 2 }), "fmt-h2");
  row("副标题", "副标题",
    () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    () => editor.isActive("heading", { level: 3 }), "fmt-h3");
  row("正文", "正文",
    () => editor.chain().focus().setParagraph().run(),
    () => editor.isActive("paragraph") &&
          !editor.isActive("bulletList") && !editor.isActive("orderedList"));

  pop.appendChild(divider());

  row("• 项目符号列表", "无序列表",
    () => editor.chain().focus().toggleBulletList().run(),
    () => editor.isActive("bulletList"));
  row("1. 编号列表", "有序列表",
    () => editor.chain().focus().toggleOrderedList().run(),
    () => editor.isActive("orderedList"));

  pop.appendChild(divider());

  row("❝ 块引用", "块引用",
    () => editor.chain().focus().toggleBlockquote().run(),
    () => editor.isActive("blockquote"));

  pop.appendChild(divider());

  // 折叠 / 展开本节（标题左边的小三角也能点，这里给个能被发现的入口）
  {
    const r = document.createElement("button");
    r.className = "fmt-row";
    r.title = "把本节内容收起来，只留标题";
    r.innerHTML =
      `<span class="fmt-check"></span><span class="fmt-label">⊟ 折叠 / 展开本节</span>` +
      `<span class="fmt-kbd">⌘⌥F</span>`;
    r.addEventListener("mousedown", (e) => e.preventDefault());
    r.addEventListener("click", () => {
      pop.classList.remove("open");
      editor.chain().focus().toggleHeadingFold().run();
    });
    pop.appendChild(r);
  }

  pop.appendChild(divider());

  // 纯文本粘贴（去格式）
  if (hooks.pastePlain) {
    const r = document.createElement("button");
    r.className = "fmt-row";
    r.title = "粘贴时去掉所有格式";
    r.innerHTML =
      `<span class="fmt-check"></span><span class="fmt-label">📋 粘贴为纯文本</span>` +
      `<span class="fmt-kbd">⌘⇧V</span>`;
    r.addEventListener("mousedown", (e) => e.preventDefault());
    r.addEventListener("click", () => {
      pop.classList.remove("open");
      hooks.pastePlain();
    });
    pop.appendChild(r);
  }

  pop.appendChild(divider());

  // 排版：字体大小（全局）+ 行距（全局）
  const sizeSel = mkSelect("字体大小",
    [["14", "小"], ["16", "标准"], ["18", "大"], ["20", "更大"],
     ["24", "超大"], ["28", "巨大"]],
    (v) => hooks.setFontSize(v));
  refreshers.push(() => (sizeSel.value = String(hooks.getFontSize())));
  pop.appendChild(typoRow("字体大小", sizeSel));

  const lhSel = mkSelect("行距",
    [["1", "1"], ["1.25", "1.25"], ["1.5", "1.5"], ["1.75", "1.75"], ["2", "2"]],
    (v) => hooks.setLineHeight(v));
  refreshers.push(() => (lhSel.value = String(hooks.getLineHeight())));
  pop.appendChild(typoRow("行距", lhSel));

  // 纸张颜色
  if (hooks.papers) {
    pop.appendChild(divider());
    const wrap = document.createElement("div");
    wrap.className = "fmt-papers";
    const label = document.createElement("div");
    label.className = "fmt-papers-label";
    label.textContent = "纸张颜色";
    wrap.appendChild(label);
    const row = document.createElement("div");
    row.className = "fmt-paper-swatches";
    hooks.papers.forEach((p) => {
      const sw = document.createElement("button");
      sw.className = "paper-swatch";
      sw.title = p.name;
      sw.style.background = p.light;
      sw.addEventListener("mousedown", (e) => e.preventDefault());
      sw.addEventListener("click", () => {
        hooks.setPaper(p.key);
        syncPapers();
      });
      sw._key = p.key;
      row.appendChild(sw);
    });
    wrap.appendChild(row);
    pop.appendChild(wrap);
    function syncPapers() {
      const cur = hooks.getPaper();
      [...row.children].forEach((sw) =>
        sw.classList.toggle("selected", sw._key === cur)
      );
    }
    refreshers.push(syncPapers);
  }

  return pop;
}

function typoRow(label, control) {
  const r = document.createElement("div");
  r.className = "fmt-typo";
  const l = document.createElement("span");
  l.className = "fmt-typo-label";
  l.textContent = label;
  r.appendChild(l);
  control.classList.add("fmt-typo-select");
  // 阻止 mousedown 丢失编辑器选区
  control.addEventListener("mousedown", (e) => e.stopPropagation());
  r.appendChild(control);
  return r;
}

function divider() {
  const d = document.createElement("div");
  d.className = "fmt-divider";
  return d;
}


// 光标所在（或上方最近）的标题位置，没有就返回 null
function nearestHeading(editor) {
  const { state } = editor;
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === "heading") return $from.before(d);
  }
  const top = $from.depth > 0 ? $from.before(1) : 0;
  let found = null;
  state.doc.forEach((node, offset) => {
    if (offset <= top && node.type.name === "heading") found = offset;
  });
  return found;
}

function currentSectionFolded(editor) {
  const pos = nearestHeading(editor);
  if (pos == null) return false;
  return !!editor.state.doc.nodeAt(pos)?.attrs.collapsed;
}

// 折叠图标：两条横线夹着一个向下的箭头，表示"收起成一行"
function foldIcon() {
  return `<svg viewBox="0 0 24 24" width="17" height="17" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="4" y1="5" x2="20" y2="5"/>
    <line x1="4" y1="19" x2="20" y2="19"/>
    <polyline points="9 10 12 13 15 10"/></svg>`;
}

// ---------- 内联 SVG 图标（保证清晰对齐）----------
function penIcon() {
  return `<svg viewBox="0 0 24 24" width="17" height="17" fill="none"
    stroke="#e0863a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z"/>
    <path d="M2 2l7.586 7.586"/></svg>`;
}
function checklistIcon() {
  return `<svg viewBox="0 0 24 24" width="17" height="17" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="9 11 12 14 22 4"/>
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
}
function tableIcon() {
  return `<svg viewBox="0 0 24 24" width="17" height="17" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
    <line x1="9" y1="3" x2="9" y2="21"/></svg>`;
}
function imageIcon() {
  return `<svg viewBox="0 0 24 24" width="17" height="17" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
}
