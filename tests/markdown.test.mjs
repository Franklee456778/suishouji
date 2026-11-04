// Markdown 导出的测试。用 node --test 跑：npm test
//
// 为什么先测这块：导出是"内容能不能拿走"的最后一道保险，一旦转换有错
// （丢内容、格式错位、图片引用不上）用户是在别的软件里才发现的，太晚了。
// 这里是纯函数，不依赖浏览器，测起来最划算。

import { test } from "node:test";
import assert from "node:assert/strict";
import { noteToMarkdown, safeFileName } from "../src/markdown.js";

const doc = (...content) => ({ type: "doc", content });
const p = (...content) => ({ type: "paragraph", content });
const txt = (text, marks) => (marks ? { type: "text", text, marks } : { type: "text", text });
const mark = (t) => ({ type: t });
const md = (note) => noteToMarkdown(note).markdown;

test("标题写在最前面", () => {
  const out = md({ title: "周报", doc: doc(p(txt("正文"))) });
  assert.equal(out, "# 周报\n\n正文\n");
});

test("各级标题转成对应数量的 #", () => {
  const out = md({
    title: "",
    doc: doc(
      { type: "heading", attrs: { level: 1 }, content: [txt("一级")] },
      { type: "heading", attrs: { level: 3 }, content: [txt("三级")] }
    ),
  });
  assert.match(out, /^# 一级$/m);
  assert.match(out, /^### 三级$/m);
});

test("行内样式：粗体 / 斜体 / 删除线 / 行内代码", () => {
  const out = md({
    title: "",
    doc: doc(
      p(
        txt("粗", [mark("bold")]),
        txt("斜", [mark("italic")]),
        txt("删", [mark("strike")]),
        txt("码", [mark("code")])
      )
    ),
  });
  assert.match(out, /\*\*粗\*\*/);
  assert.match(out, /\*斜\*/);
  assert.match(out, /~~删~~/);
  assert.match(out, /`码`/);
});

test("链接包在最外层", () => {
  const out = md({
    title: "",
    doc: doc(p(txt("点我", [mark("bold"), { type: "link", attrs: { href: "https://a.com" } }]))),
  });
  assert.match(out, /\[\*\*点我\*\*\]\(https:\/\/a\.com\)/);
});

test("无序 / 有序 / 待办列表", () => {
  const out = md({
    title: "",
    doc: doc(
      { type: "bulletList", content: [{ type: "listItem", content: [p(txt("甲"))] }] },
      { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [p(txt("乙"))] }] },
      {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [p(txt("做完了"))] },
          { type: "taskItem", attrs: { checked: false }, content: [p(txt("还没做"))] },
        ],
      }
    ),
  });
  assert.match(out, /^- 甲$/m);
  assert.match(out, /^1\. 乙$/m);
  assert.match(out, /^- \[x\] 做完了$/m);
  assert.match(out, /^- \[ \] 还没做$/m);
});

test("代码块保留语言和原文（不转义）", () => {
  const out = md({
    title: "",
    doc: doc({
      type: "codeBlock",
      attrs: { language: "js" },
      content: [txt("const a = *1*;")],
    }),
  });
  assert.match(out, /```js\nconst a = \*1\*;\n```/);
});

test("块引用每行都加 >", () => {
  const out = md({
    title: "",
    doc: doc({ type: "blockquote", content: [p(txt("引文一")), p(txt("引文二"))] }),
  });
  assert.match(out, /^> 引文一$/m);
  assert.match(out, /^> 引文二$/m);
});

test("表格转成 GFM 管道表", () => {
  const cell = (s) => ({ type: "tableCell", content: [p(txt(s))] });
  const out = md({
    title: "",
    doc: doc({
      type: "table",
      content: [
        { type: "tableRow", content: [cell("姓名"), cell("数量")] },
        { type: "tableRow", content: [cell("螺丝"), cell("12")] },
      ],
    }),
  });
  assert.match(out, /\| 姓名 \| 数量 \|/);
  assert.match(out, /\| --- \| --- \|/);
  assert.match(out, /\| 螺丝 \| 12 \|/);
});

test("图片：data URL 被抽出成文件，正文用相对路径引用", () => {
  const { markdown, images } = noteToMarkdown({
    title: "带图",
    doc: doc({
      type: "image",
      attrs: { src: "data:image/png;base64,iVBORw0KGgo=", alt: "示意图" },
    }),
  });
  assert.equal(images.length, 1);
  assert.equal(images[0].name, "image-1.png");
  assert.equal(images[0].base64, "iVBORw0KGgo=");
  assert.match(markdown, /!\[示意图\]\(assets\/image-1\.png\)/);
  assert.doesNotMatch(markdown, /base64/); // 别把几 MB 的 base64 写进 .md
});

test("链接卡片导出成普通链接", () => {
  const out = md({
    title: "",
    doc: doc({ type: "linkCard", attrs: { href: "https://x.com", title: "某站" } }),
  });
  assert.match(out, /\[某站\]\(https:\/\/x\.com\)/);
});

test("未知节点也要把里面的文字捞出来，不能丢内容", () => {
  const out = md({
    title: "",
    doc: doc({ type: "someFutureBlock", content: [p(txt("别丢了我"))] }),
  });
  assert.match(out, /别丢了我/);
});

test("会破坏 Markdown 语法的字符要转义", () => {
  const out = md({ title: "", doc: doc(p(txt("价格 * 数量 [见附录]"))) });
  assert.match(out, /\\\*/);
  assert.match(out, /\\\[/);
});

test("文件名安全化：去掉路径分隔符，保留正常字符", () => {
  assert.equal(safeFileName("2026-08 对账单"), "2026-08 对账单");
  assert.equal(safeFileName("a/b:c"), "a b c");
  assert.equal(safeFileName(""), "未命名");
  assert.equal(safeFileName("   "), "未命名");
  assert.ok(safeFileName("x".repeat(200)).length <= 80, "过长的标题要截断");
});
