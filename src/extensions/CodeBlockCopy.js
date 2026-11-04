import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { writeClipboardText } from "../clipboard.js";

// 代码块右上角浮动复制按钮（读取节点纯文本写入剪贴板）
export const CodeBlockCopy = CodeBlockLowlight.extend({
  // ⌘A 在代码块里先只全选这块代码（默认行为是选中整篇笔记，代码块里几乎没用）。
  // 已经整块选满了再按一次，就交回默认行为去全选整篇。
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      "Mod-a": () => {
        const { selection } = this.editor.state;
        const { $from, from, to } = selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name !== this.name) continue;
          const start = $from.start(d);
          const end = start + $from.node(d).content.size;
          if (from === start && to === end) return false; // 已全选 → 让默认接手
          return this.editor.commands.setTextSelection({ from: start, to: end });
        }
        return false; // 不在代码块里 → 默认行为
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("pre");
      const code = document.createElement("code");
      if (node.attrs.language) {
        code.className = "language-" + node.attrs.language;
      }
      dom.appendChild(code);

      const btn = document.createElement("button");
      btn.className = "code-copy-btn";
      btn.textContent = "复制";
      btn.contentEditable = "false";
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const pos = typeof getPos === "function" ? getPos() : null;
        const text =
          pos != null
            ? editor.state.doc.nodeAt(pos)?.textContent ?? code.textContent
            : code.textContent;
        const ok = await writeClipboardText(text);
        btn.textContent = ok ? "已复制 ✓" : "失败";
        setTimeout(() => (btn.textContent = "复制"), 1400);
      });
      dom.appendChild(btn);

      return {
        dom,
        contentDOM: code,
        // 复制按钮不参与编辑器内容，忽略其内部变更
        ignoreMutation: (m) =>
          m.target === btn || btn.contains(m.target),
      };
    };
  },
});
