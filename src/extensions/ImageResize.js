import { Image } from "@tiptap/extension-image";
import { NodeSelection } from "@tiptap/pm/state";
import { makeNodeDraggable } from "../dragnode.js";
import { resolveImageSrc } from "../imagestore.js";

// 自定义图片节点：
// - 四角缩放
// - 整图可拖拽换位（自实现拖拽：影子跟随+插入线，松手落位，周围内容自动排开）
// - 选中后工具条：前移/后移、文字环绕（居左/居右/独行）
export const ResizableImage = Image.extend({
  // 关掉 ProseMirror 的原生可拖标记——否则 WKWebView 会把手势劫持成系统原生拖拽，
  // 导致"松手不落位、要再点一下"且连带缩放失效。换位完全交给自实现的 Pointer 拖拽。
  draggable: false,

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
        parseHTML: (el) => el.getAttribute("width"),
      },
      // 文字环绕：null=独立成行，left=图居左文字绕右，right=图居右文字绕左
      float: {
        default: null,
        renderHTML: (attrs) => (attrs.float ? { "data-float": attrs.float } : {}),
        parseHTML: (el) => el.getAttribute("data-float"),
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let cur = node;
      let resizing = false; // 是否正在缩放（守卫迟到的 load 事件，别覆盖拖动中的宽度）
      const wrap = document.createElement("div");
      wrap.className = "img-resize-wrap";
      wrap.contentEditable = "false"; // 原子节点，不可编辑内部

      const img = document.createElement("img");
      img.draggable = false; // 禁用浏览器原生图片拖拽，统一走自实现拖拽
      // 笔记里存的可能是 img:xxx.png 引用，显示前转成 asset URL
      img.src = resolveImageSrc(node.attrs.src);
      if (node.attrs.alt) img.alt = node.attrs.alt;
      if (node.attrs.title) img.title = node.attrs.title;
      wrap.appendChild(img);

      // 缩放时实时显示尺寸的小标签（拖动中出现，松手消失）
      const badge = document.createElement("div");
      badge.className = "img-size-badge";
      wrap.appendChild(badge);

      function applyAttrs() {
        if (cur.attrs.width) {
          img.style.width = cur.attrs.width + "px";
        } else {
          // 没存宽度的老图：默认显示 ≤460px（不超过原图自身宽），不再一进来就满宽，
          // 这样既能往大拖也能往小拖。纯显示，不改你已保存的笔记数据。
          const cap = Math.min(img.naturalWidth || 460, 460);
          img.style.width = img.naturalWidth ? cap + "px" : "";
        }
        if (cur.attrs.float) wrap.dataset.float = cur.attrs.float;
        else delete wrap.dataset.float;
      }
      applyAttrs();
      // 原图尺寸要等加载完才知道，加载后再套一次默认宽。
      // 加 !resizing 守卫：缩放进行中若图片 load 事件迟到，绝不让默认宽覆盖正在拖的宽度。
      img.addEventListener("load", () => {
        if (!resizing && !cur.attrs.width) applyAttrs();
      });

      // 四角缩放手柄
      ["tl", "tr", "bl", "br"].forEach((c) => {
        const h = document.createElement("div");
        h.className = "img-handle " + c;
        wrap.appendChild(h);
        // 鼠标和指针两种按下都能启动缩放——真机 WKWebView 到底派发哪种不确定，全都接住。
        h.addEventListener("mousedown", (e) => startResize(e, c));
        h.addEventListener("pointerdown", (e) => startResize(e, c));
      });

      // 工具条（选中时显示）
      const bar = document.createElement("div");
      bar.className = "img-toolbar";
      bar.contentEditable = "false";
      const mkBtn = (label, title, fn) => {
        const btn = document.createElement("button");
        btn.className = "img-move-btn";
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          fn();
        });
        bar.appendChild(btn);
        return btn;
      };
      mkBtn("◀", "和前一个对调位置", () => moveImage(-1));
      mkBtn("▶", "和后一个对调位置", () => moveImage(1));
      mkBtn("居左", "图片居左，文字环绕在右", () => setFloat("left"));
      mkBtn("居右", "图片居右，文字环绕在左", () => setFloat("right"));
      mkBtn("独行", "取消环绕，独立成行", () => setFloat(null));
      wrap.appendChild(bar);

      // TipTap 3：getPos() 在节点刚被删时可能返回 undefined，下面每处都先判空
      function selectNode() {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos != null) editor.commands.setNodeSelection(pos);
      }
      img.addEventListener("click", selectNode);
      // 整图拖拽换位（自实现，跳过缩放手柄和工具条）
      makeNodeDraggable(editor, getPos, wrap, {
        ignore: ".img-handle, .img-toolbar",
      });

      function setFloat(v) {
        if (typeof getPos !== "function") return;
        const pos = getPos();
        if (pos == null) return;
        const n = editor.state.doc.nodeAt(pos);
        if (!n) return;
        editor
          .chain()
          .command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, { ...n.attrs, float: v });
            return true;
          })
          .run();
      }

      // 和相邻同级节点对调位置（dir<0 前移，dir>0 后移）
      function moveImage(dir) {
        if (typeof getPos !== "function") return;
        const view = editor.view;
        const pos = getPos();
        if (pos == null) return;
        const curNode = view.state.doc.nodeAt(pos);
        if (!curNode) return;
        const $pos = view.state.doc.resolve(pos);
        const idx = $pos.index();
        const parent = $pos.parent;
        const size = curNode.nodeSize;
        let newPos;
        let tr = view.state.tr;
        if (dir < 0) {
          if (idx === 0) return;
          const prev = parent.child(idx - 1);
          newPos = pos - prev.nodeSize;
          tr = tr.delete(pos, pos + size).insert(newPos, curNode);
        } else {
          if (idx >= parent.childCount - 1) return;
          const next = parent.child(idx + 1);
          tr = tr.delete(pos, pos + size);
          newPos = pos + next.nodeSize;
          tr = tr.insert(newPos, curNode);
        }
        try {
          tr = tr.setSelection(NodeSelection.create(tr.doc, newPos));
        } catch {}
        view.dispatch(tr.scrollIntoView());
        view.focus();
      }

      // 缩放：指针捕获 + 拖动期间零重绘 + 鼠标兜底。
      // 关键认识：WKWebView 在富文本里会把"按住拖动"当成原生文字选择拖拽、吞掉后续
      // 移动事件——这正是预览能用而真机不能的根因。对策：
      // ① pointerdown 时 setPointerCapture 把后续 pointermove 强制锁到手柄上（绕过选择拖拽）；
      // ② 拖动全程绝不 dispatch（不 selectNode、不 setNodeMarkup），NodeView 不重绘、
      //    手柄 DOM 稳定，capture 不会被丢弃（这是 v0.1.9 失败的真因：当时开头就 selectNode→重绘→丢 capture）；
      // ③ 同时挂 document 鼠标事件兜底——真机若只派发 mouse 也能用（历史可靠模型）。
      function startResize(e, corner) {
        if (resizing) return; // pointerdown 与 mousedown 同次按下都会来，去重
        resizing = true;
        e.preventDefault();
        e.stopPropagation();
        const handleEl = e.currentTarget;
        const isPointer = e.type === "pointerdown";
        const pid = e.pointerId;
        const startX = e.clientX;
        const startW = img.getBoundingClientRect().width;
        const ratio = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0;
        const leftSide = corner === "tl" || corner === "bl";
        let lastW = startW; // 记录拖动算出的最后宽度，松手就提交它——绝不在松手时重新测量
        let rafId = null;

        // 逐帧渲染：多次 pointermove 只在下一帧统一写一次样式，
        // 让 WKWebView 有空当真正重绘每一帧——图片缩放实时跟手，不再等松手才刷新。
        const paint = () => {
          rafId = null;
          img.style.maxWidth = "none";
          img.style.width = lastW + "px";
          wrap.style.width = lastW + "px";
          const w = Math.round(lastW);
          const h = ratio ? Math.round(lastW * ratio) : 0;
          badge.textContent = h ? w + " × " + h : w + " px";
        };
        badge.classList.add("show");

        const onMove = (ev) => {
          const delta = ev.clientX - startX;
          let w = leftSide ? startW - delta : startW + delta;
          const maxW = wrap.parentElement ? wrap.parentElement.clientWidth : 680;
          lastW = Math.max(60, Math.min(w, maxW));
          if (rafId == null) rafId = requestAnimationFrame(paint);
        };
        const onUp = () => {
          resizing = false;
          if (rafId != null) cancelAnimationFrame(rafId);
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          handleEl.removeEventListener("pointermove", onMove);
          handleEl.removeEventListener("pointerup", onUp);
          handleEl.removeEventListener("pointercancel", onUp);
          try {
            handleEl.releasePointerCapture(pid);
          } catch {}
          badge.classList.remove("show");
          // ★用拖动过程记下的 lastW 提交，绝不在松手时重新 getBoundingClientRect——
          // 那一刻元素可能已被默认宽/重排回弹（这是"拖完又跳回去"的真因）。
          const finalW = Math.round(lastW);
          img.style.width = finalW + "px"; // 先锁死，避免恢复 max-width 后短暂回弹
          img.style.maxWidth = ""; // 交回 CSS（max-width:100% 防溢出；finalW 已 ≤ 容器宽）
          wrap.style.width = "";
          if (typeof getPos === "function") {
            const pos = getPos();
            const n = pos == null ? null : editor.state.doc.nodeAt(pos);
            if (n) {
              editor
                .chain()
                .command(({ tr }) => {
                  tr.setNodeMarkup(pos, undefined, { ...n.attrs, width: finalW });
                  return true;
                })
                .run();
            }
          }
        };

        // 指针路径：捕获到手柄，强制 pointermove 必达（绕过 WKWebView 选择拖拽吞事件）
        if (isPointer) {
          try {
            handleEl.setPointerCapture(pid);
          } catch {}
          handleEl.addEventListener("pointermove", onMove);
          handleEl.addEventListener("pointerup", onUp);
          handleEl.addEventListener("pointercancel", onUp);
        }
        // 鼠标兜底：真机若走 mouse 事件，document 级照样驱动
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        paint(); // 立刻显示一次初始尺寸
        // 注意：不在此调用 selectNode()——它会 dispatch 触发重绘、丢掉 capture。
      }

      return {
        dom: wrap,
        selectNode() {
          wrap.classList.add("selected");
        },
        deselectNode() {
          wrap.classList.remove("selected");
        },
        update(updatedNode) {
          if (updatedNode.type.name !== "image") return false;
          cur = updatedNode;
          const nextSrc = resolveImageSrc(updatedNode.attrs.src);
          if (nextSrc !== img.src) img.src = nextSrc;
          applyAttrs();
          return true;
        },
        // 忽略本 NodeView 内的所有 DOM 变动：图片是 contentEditable=false 的原子节点，
        // ProseMirror 不需要从它的 DOM 反推内容。若不忽略，缩放时改 img/wrap 的宽度会被
        // ProseMirror 的 MutationObserver "纠正"回节点存的旧宽——这正是缩放"拖动中不实时、
        // 一直被弹回原大小"的真正根因（之前只忽略了手柄上的变动，没覆盖 img/wrap 本身）。
        ignoreMutation: () => true,
      };
    };
  },
});
