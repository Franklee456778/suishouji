import { NodeSelection } from "@tiptap/pm/state";
import { dropPoint } from "@tiptap/pm/transform";

// 块节点拖拽（图片/链接卡片）—— Pointer Events + 指针捕获版。
//
// 为什么不用鼠标事件/原生 DnD：macOS WKWebView 会把"可拖元素上的按住移动"
// 劫持为系统原生拖拽会话，mouseup 永远不会派发 —— 自实现的鼠标版会话卡死，
// 直到用户下一次点击才"补"上落位（即"放手没反应、再点一下才生效"），
// 残留的捕获监听还会吞掉缩放手柄的 mouseup，连带缩放也坏。
// Pointer Events + setPointerCapture 由浏览器保证 pointerup 必达；
// 配合 pointerdown preventDefault（按规范会抑制全部兼容鼠标事件与原生拖拽），
// 整个手势完全由这里闭环处理。
export function makeNodeDraggable(editor, getPos, dom, { ignore = "" } = {}) {
  // 多重保险：杀掉一切原生拖拽入口
  dom.draggable = false;
  dom.addEventListener("dragstart", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  dom.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    if (ignore && e.target.closest(ignore)) return; // 手柄/按钮走原生鼠标流程
    e.preventDefault(); // 抑制 mousedown/click/原生拖拽/PM 自身的鼠标处理

    const pid = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let ghost = null;
    let indicator = null;

    const cleanup = () => {
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointercancel", onCancel);
      try {
        dom.releasePointerCapture(pid);
      } catch {}
      ghost?.remove();
      indicator?.remove();
      document.body.classList.remove("node-dragging");
    };
    const onCancel = () => cleanup();

    const onMove = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        dragging = true;
        document.body.classList.add("node-dragging");
        try {
          window.getSelection()?.removeAllRanges();
        } catch {}
        try {
          if (typeof getPos === "function") editor.commands.setNodeSelection(getPos());
        } catch {}
        ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        const clone = dom.cloneNode(true);
        clone
          .querySelectorAll(".img-handle, .img-toolbar, .link-card-handle, .link-card-open")
          .forEach((n) => n.remove());
        ghost.appendChild(clone);
        document.body.appendChild(ghost);
        indicator = document.createElement("div");
        indicator.className = "drop-indicator";
        document.body.appendChild(indicator);
      }
      ev.preventDefault();
      ghost.style.left = ev.clientX + 14 + "px";
      ghost.style.top = ev.clientY + 14 + "px";
      const t = dropTarget(editor.view, ev, getPos);
      if (t == null) {
        indicator.style.display = "none";
      } else {
        placeIndicator(indicator, editor.view, t);
      }
    };

    const onUp = (ev) => {
      const wasDragging = dragging;
      // 先算落点再清理（清理会移除 ghost/indicator，但坐标计算不受影响）
      const t = wasDragging ? dropTarget(editor.view, ev, getPos) : null;
      cleanup();
      if (!wasDragging) {
        // 没拖动 = 单击：选中节点（pointerdown 已抑制原生 click，这里补上选中）
        try {
          editor.view.focus();
          if (typeof getPos === "function") editor.commands.setNodeSelection(getPos());
        } catch {}
        return;
      }
      if (t == null) return;
      let src;
      try {
        src = getPos();
      } catch {
        return;
      }
      if (src == null) return; // TipTap 3：节点刚被删时 getPos() 返回 undefined
      moveNode(editor, src, t);
    };

    try {
      dom.setPointerCapture(pid); // 保证 pointerup 必达本元素
    } catch {}
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("pointercancel", onCancel);
  });
}

// 计算松手处的合法插入点；落在自己身上返回 null
function dropTarget(view, ev, getPos) {
  const at = view.posAtCoords({ left: ev.clientX, top: ev.clientY });
  if (!at) return null;
  let srcPos;
  try {
    srcPos = getPos();
  } catch {
    return null;
  }
  if (srcPos == null) return null;
  const node = view.state.doc.nodeAt(srcPos);
  if (!node) return null;
  let point;
  try {
    const slice = NodeSelection.create(view.state.doc, srcPos).content();
    point = dropPoint(view.state.doc, at.pos, slice);
  } catch {
    return null;
  }
  if (point == null) return null;
  if (point >= srcPos && point <= srcPos + node.nodeSize) return null;
  return point;
}

const isAtomBlock = (n) => n && (n.type.name === "image" || n.type.name === "linkCard");

// 插入线：两个并排的图片/卡片之间画竖线，其余画横线
function placeIndicator(el, view, pos) {
  el.style.display = "block";
  const $pos = view.state.doc.resolve(pos);
  const before = $pos.nodeBefore;
  const after = $pos.nodeAfter;
  const rectOf = (p) => {
    try {
      const d = view.nodeDOM(p);
      return d && d.getBoundingClientRect ? d.getBoundingClientRect() : null;
    } catch {
      return null;
    }
  };
  if (isAtomBlock(before) && isAtomBlock(after)) {
    const rb = rectOf(pos - before.nodeSize);
    const ra = rectOf(pos);
    if (rb && ra && Math.abs(rb.top - ra.top) < 14) {
      el.style.left = (rb.right + ra.left) / 2 - 1.5 + "px";
      el.style.top = Math.min(rb.top, ra.top) + "px";
      el.style.width = "3px";
      el.style.height = Math.max(rb.height, ra.height) + "px";
      return;
    }
  }
  let c;
  try {
    c = view.coordsAtPos(pos);
  } catch {
    el.style.display = "none";
    return;
  }
  const er = view.dom.getBoundingClientRect();
  el.style.left = er.left + 10 + "px";
  el.style.width = er.width - 20 + "px";
  el.style.top = c.top - 2 + "px";
  el.style.height = "3px";
}

function moveNode(editor, srcPos, targetPos) {
  const { state } = editor.view;
  const node = state.doc.nodeAt(srcPos);
  if (!node) return;
  let tr = state.tr.delete(srcPos, srcPos + node.nodeSize);
  const mapped = tr.mapping.map(targetPos);
  tr = tr.insert(mapped, node);

  // 智能环绕：图片落在一段有文字的段落前面 → 自动浮动，文字排到它旁边；
  // 挪到不挨着文字处 → 取消浮动，独立成行。
  if (node.type.name === "image") {
    let after = null;
    try {
      after = tr.doc.resolve(mapped + node.nodeSize).nodeAfter;
    } catch {}
    const nextToText =
      after && after.type.name === "paragraph" && after.content.size > 0;
    let float = node.attrs.float;
    if (nextToText && !float) float = "left";
    else if (!nextToText && float) float = null;
    if (float !== node.attrs.float) {
      tr = tr.setNodeMarkup(mapped, undefined, { ...node.attrs, float });
    }
  }

  try {
    tr = tr.setSelection(NodeSelection.create(tr.doc, mapped));
  } catch {}
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}
