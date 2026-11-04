import { Heading } from "@tiptap/extension-heading";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { searchKey } from "./SearchHighlight.js";
import { iconChevron } from "../icons.js";

// 按标题折叠：点标题左边的小三角，把这个标题下面的内容整段收起来，只留标题。
//
// 实现要点：
// ① 折叠状态存在 heading 节点的 collapsed 属性里 → 随笔记一起保存，重开还在。
// ② 隐藏内容用 **装饰（Decoration）**，不动文档本身——折叠只是显示层的事，
//    绝不会因为折叠而丢内容（这点很重要，出问题也只是看不见，数据还在）。
// ③ 不用自定义 NodeView：本项目在 NodeView 上踩过 ProseMirror MutationObserver
//    的坑（改 DOM 会被纠正回去）。三角是 widget 装饰里的真实 <button>，点击可靠。

export const foldKey = new PluginKey("foldableHeading");

// 一个折叠标题管辖的范围：从标题结束，到下一个同级或更高级标题之前
function foldRanges(doc) {
  const kids = [];
  doc.forEach((node, offset) => kids.push({ node, offset }));

  const ranges = [];
  for (let i = 0; i < kids.length; i++) {
    const { node, offset } = kids[i];
    if (node.type.name !== "heading" || !node.attrs.collapsed) continue;
    const level = node.attrs.level;
    // 折叠时记下"折了几块"。没有这个上限的话，最后一节的折叠范围会一直
    // 延伸到文档末尾——那样它后面就不存在"外面"，用户没法在折叠区之后接着写。
    // 有了上限，新加的内容落在范围之外，照样可见可编辑。
    const limit = node.attrs.foldCount;
    let to = offset + node.nodeSize;
    let count = 0;
    for (let j = i + 1; j < kids.length; j++) {
      const c = kids[j];
      if (c.node.type.name === "heading" && c.node.attrs.level <= level) break;
      if (limit != null && count >= limit) break;
      to = c.offset + c.node.nodeSize;
      count++;
    }
    if (count > 0) {
      const from = offset + node.nodeSize;
      // 提示里显示"行数"而不是顶层块数：一节常常就是一个列表（顶层算 1 块），
      // 写成"1 段"看不出收了多少东西，按里面的文本行数数才直观。
      let lines = 0;
      doc.nodesBetween(from, to, (n) => {
        if (n.isTextblock) lines++;
      });
      ranges.push({ headingPos: offset, from, to, count: lines || count });
    }
  }
  return ranges;
}

/** 当前文档里所有折叠区间（给界面判断"文末是否在折叠区里"用） */
export function foldedRangesOf(state) {
  return foldRanges(state.doc);
}

function isHidden(ranges, offset) {
  return ranges.some((r) => offset >= r.from && offset < r.to);
}

// 数一数这个标题下面有几个顶层块（到下一个同级或更高级标题为止）
function sectionSize(doc, headingPos) {
  const kids = [];
  doc.forEach((node, offset) => kids.push({ node, offset }));
  const i = kids.findIndex((k) => k.offset === headingPos);
  if (i < 0) return 0;
  const level = kids[i].node.attrs.level;
  let n = 0;
  for (let j = i + 1; j < kids.length; j++) {
    const c = kids[j];
    if (c.node.type.name === "heading" && c.node.attrs.level <= level) break;
    n++;
  }
  return n;
}

// 切换某个标题的折叠状态
function toggleAt(view, headingPos) {
  const { state, dispatch } = view;
  const node = state.doc.nodeAt(headingPos);
  if (!node || node.type.name !== "heading") return;
  const collapsing = !node.attrs.collapsed;
  const tr = state.tr.setNodeMarkup(headingPos, undefined, {
    ...node.attrs,
    collapsed: collapsing,
    foldCount: collapsing ? sectionSize(state.doc, headingPos) : null,
  });
  // 折叠时若光标正在这一节里面，先把它挪到标题上。
  // 否则光标留在隐藏区域，下面的"选区进入隐藏内容就自动展开"会立刻把它又展开。
  if (collapsing) {
    const { from, to } = state.selection;
    const secEnd = foldRanges(tr.doc).find((r) => r.headingPos === headingPos)?.to;
    if (secEnd != null && from < secEnd && to > headingPos) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(headingPos + 1)));
    }
  }
  dispatch(tr.scrollIntoView());
}

function toggleButton(view, headingPos, collapsed) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fold-toggle" + (collapsed ? " folded" : "");
  btn.contentEditable = "false";
  btn.innerHTML = iconChevron(15);   // 折叠态由 CSS 旋转 -90°，不用换图形
  btn.title = collapsed ? "展开本节" : "折叠本节";
  btn.setAttribute("aria-label", btn.title);
  // 别让按下按钮改变编辑器选区
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    toggleAt(view, headingPos);
  });
  return btn;
}

function foldedBadge(view, headingPos, count) {
  const span = document.createElement("span");
  span.className = "fold-badge";
  span.contentEditable = "false";
  span.textContent = `⋯ ${count} 行`;
  span.title = "点击展开";
  span.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  span.addEventListener("click", (e) => {
    e.preventDefault();
    toggleAt(view, headingPos);
  });
  return span;
}

// 折叠了最后一节时，它后面就没有可见的落点了——正文下方虽然点得动，
// 但没有任何提示。这里在折叠区后面显示一行明确的入口。
function tailButton(view) {
  const row = document.createElement("div");
  row.className = "fold-tail";
  row.contentEditable = "false";
  row.textContent = "＋ 在这里继续写";
  row.title = "在折叠内容的后面新起一段";
  row.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  row.addEventListener("click", (e) => {
    e.preventDefault();
    const { state, dispatch } = view;
    const end = state.doc.content.size;
    const tr = state.tr.insert(end, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size)));
    dispatch(tr.scrollIntoView());
    view.focus();
  });
  return row;
}

function buildDecorations(state) {
  const { doc } = state;
  const ranges = foldRanges(doc);
  // 查找**命中**时才临时不隐藏：否则 ⌘F 找到折叠区里的字，用户什么也看不见。
  // 注意要看有没有命中，而不是"有没有输入搜索词"——边打字边搜时大部分中间状态
  // 是零命中的，只要有词就展开会让折叠区无端弹开。
  const search = searchKey.getState(state);
  const searching = !!search?.term && search.matches?.length > 0;
  const decos = [];

  doc.forEach((node, offset) => {
    if (node.type.name === "heading") {
      const collapsed = !!node.attrs.collapsed;
      const range = ranges.find((r) => r.headingPos === offset);
      decos.push(
        Decoration.widget(offset + 1, (view) => toggleButton(view, offset, collapsed), {
          side: -1,
          ignoreSelection: true,
          key: `fold-toggle-${offset}-${collapsed}`,
        })
      );
      if (collapsed && range) {
        decos.push(
          Decoration.widget(
            offset + node.nodeSize - 1,
            (view) => foldedBadge(view, offset, range.count),
            { side: 1, ignoreSelection: true, key: `fold-badge-${offset}-${range.count}` }
          )
        );
      }
      return;
    }
    if (!searching && isHidden(ranges, offset)) {
      decos.push(
        Decoration.node(offset, offset + node.nodeSize, { class: "fold-hidden" })
      );
    }
  });

  // 折叠区里嵌套的标题也要一起藏起来
  if (!searching) {
    doc.forEach((node, offset) => {
      if (node.type.name === "heading" && isHidden(ranges, offset)) {
        decos.push(
          Decoration.node(offset, offset + node.nodeSize, { class: "fold-hidden" })
        );
      }
    });
  }

  // 文末正好在某个折叠区里 = 这一节后面没有任何可见内容 → 给个明确的续写入口
  const end = doc.content.size;
  if (!searching && ranges.some((r) => end > r.from && end <= r.to)) {
    decos.push(
      Decoration.widget(end, (view) => tailButton(view), {
        side: 1,
        ignoreSelection: true,
        key: "fold-tail",
      })
    );
  }

  return DecorationSet.create(doc, decos);
}

export const FoldableHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // 折叠时这一节有几个顶层块。用来把折叠范围钉死，
      // 之后在这一节后面新写的内容就不会被一起吞掉。
      foldCount: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
      collapsed: {
        default: false,
        // 存进笔记，重开还保持折叠
        parseHTML: (el) => el.getAttribute("data-collapsed") === "true",
        renderHTML: (attrs) =>
          attrs.collapsed ? { "data-collapsed": "true" } : {},
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      // 折叠 / 展开光标所在（或上方最近）的标题
      toggleHeadingFold:
        () =>
        ({ state, dispatch }) => {
          const { $from } = state.selection;
          let pos = null;
          // 光标就在标题里
          for (let d = $from.depth; d >= 0; d--) {
            if ($from.node(d).type.name === "heading") {
              pos = $from.before(d);
              break;
            }
          }
          // 否则往上找最近的标题
          if (pos == null) {
            const top = $from.depth > 0 ? $from.before(1) : 0;
            let found = null;
            state.doc.forEach((node, offset) => {
              if (offset <= top && node.type.name === "heading") found = offset;
            });
            pos = found;
          }
          if (pos == null) return false;
          const node = state.doc.nodeAt(pos);
          if (!node) return false;
          if (dispatch) {
            const collapsing = !node.attrs.collapsed;
            const tr = state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              collapsed: collapsing,
              foldCount: collapsing ? sectionSize(state.doc, pos) : null,
            });
            // ⚠️ 折叠时必须把光标挪到标题上。
            // 用工具栏按钮 / ⌘⌥F 折叠时，光标通常正在这一节的正文里，
            // 而"选区进入隐藏内容就自动展开"那条保护会立刻把它展开回来——
            // 表现就是"点了按钮没反应"。移走光标才折得住。
            if (collapsing) {
              const secEnd = foldRanges(tr.doc).find((r) => r.headingPos === pos)?.to;
              const { from, to } = state.selection;
              if (secEnd != null && from < secEnd && to > pos) {
                tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
              }
            }
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
      // 全部展开（比如查找前想看全文）
      expandAllHeadings:
        () =>
        ({ state, dispatch }) => {
          const targets = [];
          state.doc.forEach((node, offset) => {
            if (node.type.name === "heading" && node.attrs.collapsed) {
              targets.push({ offset, attrs: node.attrs });
            }
          });
          if (!targets.length) return false;
          if (dispatch) {
            const tr = state.tr;
            targets.forEach((t) =>
              tr.setNodeMarkup(t.offset, undefined, {
                ...t.attrs,
                collapsed: false,
                foldCount: null,
              })
            );
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      "Mod-Alt-f": () => this.editor.commands.toggleHeadingFold(),
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      new Plugin({
        key: foldKey,
        props: {
          decorations: (state) => buildDecorations(state),
        },
        // 光标进了隐藏区域（比如在标题末尾按回车、或方向键走进去）就自动展开，
        // 不然会在看不见的地方打字。
        appendTransaction(trs, oldState, newState) {
          if (!trs.some((tr) => tr.docChanged || tr.selectionSet)) return null;
          const ranges = foldRanges(newState.doc);
          if (!ranges.length) return null;
          const { from, to } = newState.selection;
          let tr = null;
          for (const r of ranges) {
            if (from < r.to && to > r.from) {
              const node = newState.doc.nodeAt(r.headingPos);
              if (node?.attrs.collapsed) {
                tr = tr || newState.tr;
                tr.setNodeMarkup(r.headingPos, undefined, {
                  ...node.attrs,
                  collapsed: false,
                  foldCount: null,
                });
              }
            }
          }
          return tr;
        },
      }),
    ];
  },
});
