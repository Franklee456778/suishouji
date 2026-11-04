import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const searchKey = new PluginKey("searchHighlight");

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 计算所有匹配位置 + 装饰
function compute(doc, term, current) {
  const matches = [];
  if (term) {
    const re = new RegExp(escapeRegExp(term), "gi");
    doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      let m;
      while ((m = re.exec(node.text))) {
        if (m[0] === "") {
          re.lastIndex++;
          continue;
        }
        matches.push({ from: pos + m.index, to: pos + m.index + m[0].length });
      }
    });
  }
  const cur = matches.length ? ((current % matches.length) + matches.length) % matches.length : 0;
  const decos = matches.map((mch, i) =>
    Decoration.inline(mch.from, mch.to, {
      class: i === cur ? "search-hit search-hit-active" : "search-hit",
    })
  );
  return { matches, current: cur, deco: DecorationSet.create(doc, decos) };
}

export const SearchHighlight = Extension.create({
  name: "searchHighlight",

  addStorage() {
    return { term: "", matches: [], current: 0 };
  },

  addCommands() {
    return {
      setSearchTerm:
        (term) =>
        ({ dispatch, tr }) => {
          if (dispatch) dispatch(tr.setMeta(searchKey, { term, current: 0 }));
          return true;
        },
      stepSearch:
        (dir) =>
        ({ state, dispatch, tr }) => {
          const ps = searchKey.getState(state);
          if (!ps || !ps.matches.length) return false;
          const next = ps.current + dir;
          if (dispatch) dispatch(tr.setMeta(searchKey, { current: next }));
          return true;
        },
      clearSearch:
        () =>
        ({ dispatch, tr }) => {
          if (dispatch) dispatch(tr.setMeta(searchKey, { term: "", current: 0 }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin({
        key: searchKey,
        state: {
          init() {
            return { term: "", matches: [], current: 0, deco: DecorationSet.empty };
          },
          apply(tr, value, oldState, newState) {
            const meta = tr.getMeta(searchKey);
            let term = value.term;
            let current = value.current;
            if (meta) {
              if (meta.term !== undefined) {
                term = meta.term;
                current = meta.current ?? 0;
              } else if (meta.current !== undefined) {
                current = meta.current;
              }
            } else if (!tr.docChanged) {
              return value; // 无关事务，保持
            }
            const res = compute(newState.doc, term, current);
            ext.storage.term = term;
            ext.storage.matches = res.matches;
            ext.storage.current = res.current;
            return { term, matches: res.matches, current: res.current, deco: res.deco };
          },
        },
        props: {
          decorations(state) {
            return searchKey.getState(state)?.deco;
          },
        },
      }),
    ];
  },
});
