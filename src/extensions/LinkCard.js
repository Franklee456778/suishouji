import { Node } from "@tiptap/core";
import { openExternal, SAFE_URL } from "../openurl.js";
import { makeNodeDraggable } from "../dragnode.js";

// 链接卡片：粘贴网址生成。抓到站点元信息后显示 缩略图+标题，否则显示 图标+域名。
// 可拖宽窄（右缘）、可整卡拖动换位、点 ↗ 用系统浏览器打开。
export const LinkCard = Node.create({
  name: "linkCard",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false, // 原生拖拽关掉，换位走自实现 Pointer 拖拽（见 dragnode.js）

  addAttributes() {
    return {
      href: { default: "" },
      width: { default: 340 },
      title: { default: "" },
      image: { default: null }, // 缩略图 dataURL（抓取后本地保存，不再联网）
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-link-card]",
        getAttrs: (el) => ({
          href: el.getAttribute("data-href") || "",
          width: Number(el.getAttribute("data-width")) || 340,
          title: el.getAttribute("data-title") || "",
          image: el.getAttribute("data-image") || null,
        }),
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "div",
      {
        "data-link-card": "",
        "data-href": node.attrs.href,
        "data-width": node.attrs.width,
        "data-title": node.attrs.title || undefined,
        "data-image": node.attrs.image || undefined,
      },
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let cur = node;
      const card = document.createElement("div");
      card.className = "link-card";
      card.contentEditable = "false";

      card.innerHTML =
        `<div class="link-card-thumb"><img alt=""></div>` +
        `<div class="link-card-body">` +
        `<div class="link-card-icon">` +
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">` +
        `<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>` +
        `<path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/></svg></div>` +
        `<div class="link-card-text">` +
        `<div class="link-card-host"></div><div class="link-card-url"></div></div>` +
        `<button class="link-card-open" title="在浏览器打开">↗</button></div>` +
        `<div class="link-card-handle" title="左右拖动调整宽度"></div>`;

      const thumb = card.querySelector(".link-card-thumb");
      const thumbImg = thumb.querySelector("img");
      const iconEl = card.querySelector(".link-card-icon");
      const hostEl = card.querySelector(".link-card-host");
      const urlEl = card.querySelector(".link-card-url");

      function render() {
        let host = "";
        try {
          host = new URL(cur.attrs.href).host.replace(/^www\./, "");
        } catch {}
        hostEl.textContent = cur.attrs.title || host || "链接";
        urlEl.textContent = cur.attrs.href;
        card.style.width = (cur.attrs.width || 340) + "px";
        const hasThumb = !!cur.attrs.image;
        card.classList.toggle("has-thumb", hasThumb);
        thumb.style.display = hasThumb ? "" : "none";
        iconEl.style.display = hasThumb ? "none" : "";
        if (hasThumb && thumbImg.src !== cur.attrs.image) thumbImg.src = cur.attrs.image;
      }
      render();

      // TipTap 3：getPos() 在节点刚被删时可能返回 undefined
      function selectNode() {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos != null) editor.commands.setNodeSelection(pos);
      }
      card.addEventListener("click", selectNode);

      // 整卡拖动换位（自实现拖拽）
      makeNodeDraggable(editor, getPos, card, {
        ignore: ".link-card-handle, .link-card-open",
      });

      card.querySelector(".link-card-open").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (SAFE_URL.test(cur.attrs.href)) openExternal(cur.attrs.href);
      });

      // 右缘拖宽：双保险事件模型（同图片缩放）——mouse/pointer 两种按下都接，
      // move/up 挂 document，不依赖 setPointerCapture/手柄存活，WKWebView 下可靠。
      const wHandle = card.querySelector(".link-card-handle");
      let cardResizing = false;
      const startWidthResize = (e) => {
        if (cardResizing) return;
        cardResizing = true;
        e.preventDefault();
        e.stopPropagation();
        const handleEl = e.currentTarget;
        const isPointer = e.type === "pointerdown";
        const pid = e.pointerId;
        const startX = e.clientX;
        const startW = card.getBoundingClientRect().width;
        const max = card.parentElement ? card.parentElement.clientWidth : 680;
        const onMove = (ev) => {
          const w = Math.max(200, Math.min(startW + (ev.clientX - startX), max));
          card.style.width = w + "px";
        };
        const onUp = () => {
          cardResizing = false;
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          handleEl.removeEventListener("pointermove", onMove);
          handleEl.removeEventListener("pointerup", onUp);
          handleEl.removeEventListener("pointercancel", onUp);
          try {
            handleEl.releasePointerCapture(pid);
          } catch {}
          const finalW = Math.round(card.getBoundingClientRect().width);
          const pos = typeof getPos === "function" ? getPos() : null;
          if (pos != null) {
            editor
              .chain()
              .command(({ tr }) => {
                tr.setNodeMarkup(pos, undefined, { ...cur.attrs, width: finalW });
                return true;
              })
              .run();
          }
        };
        // 同图片缩放：指针捕获绕过 WKWebView 选择拖拽吞事件 + 拖动期间零重绘 + 鼠标兜底。
        if (isPointer) {
          try {
            handleEl.setPointerCapture(pid);
          } catch {}
          handleEl.addEventListener("pointermove", onMove);
          handleEl.addEventListener("pointerup", onUp);
          handleEl.addEventListener("pointercancel", onUp);
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        // 不在此 selectNode（避免 dispatch 重绘丢 capture）；卡片 hover 即显示手柄。
      };
      wHandle.addEventListener("mousedown", startWidthResize);
      wHandle.addEventListener("pointerdown", startWidthResize);

      return {
        dom: card,
        selectNode() {
          card.classList.add("selected");
        },
        deselectNode() {
          card.classList.remove("selected");
        },
        update(n) {
          if (n.type.name !== "linkCard") return false;
          cur = n;
          render();
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
});
