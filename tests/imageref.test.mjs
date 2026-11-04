// 图片改成"独立文件+引用"之后，导出这条链路最容易出错：
// 引用没被收集 → 导出的 .md 里图片是坏链；base64 没被抽出 → .md 里塞进几 MB 乱码。
// 这里只测纯逻辑（不碰文件系统），文件读写要装了新版在真机验。

import { test } from "node:test";
import assert from "node:assert/strict";
import { noteToMarkdown } from "../src/markdown.js";

const doc = (...content) => ({ type: "doc", content });
const img = (src, alt) => ({ type: "image", attrs: { src, alt } });

test("文件引用 img: → 相对路径 + 记进待复制清单", () => {
  const { markdown, images } = noteToMarkdown({
    title: "带图",
    doc: doc(img("img:abc123.png", "示意")),
  });
  assert.match(markdown, /!\[示意\]\(assets\/abc123\.png\)/);
  assert.deepEqual(images, [{ name: "abc123.png", copyFrom: "abc123.png" }]);
});

test("内嵌 base64 → 抽成待写文件（加密笔记仍走这条）", () => {
  const { markdown, images } = noteToMarkdown({
    title: "",
    doc: doc(img("data:image/jpeg;base64,QUJD", "")),
  });
  assert.equal(images.length, 1);
  assert.equal(images[0].name, "image-1.jpg");
  assert.equal(images[0].base64, "QUJD");
  assert.ok(!images[0].copyFrom, "base64 来源不该带 copyFrom");
  assert.doesNotMatch(markdown, /base64/);
});

test("两种来源混在一篇里都能正确处理", () => {
  const { markdown, images } = noteToMarkdown({
    title: "",
    doc: doc(img("img:file1.webp", "文件"), img("data:image/png;base64,QQ==", "内嵌")),
  });
  assert.equal(images.length, 2);
  assert.equal(images[0].copyFrom, "file1.webp");
  assert.equal(images[1].base64, "QQ==");
  assert.match(markdown, /assets\/file1\.webp/);
  assert.match(markdown, /assets\/image-2\.png/); // 编号按出现顺序，不和文件名冲突
});

test("外部网址图片原样保留，不当成本地文件", () => {
  const { markdown, images } = noteToMarkdown({
    title: "",
    doc: doc(img("https://example.com/a.png", "网图")),
  });
  assert.match(markdown, /!\[网图\]\(https:\/\/example\.com\/a\.png\)/);
  assert.equal(images.length, 0);
});

// 安全：引用里的文件名会拼进磁盘路径，带 ../ 的必须挡掉，正常文件名必须放行
import { isSafeImageName } from "../src/imagestore.js";

test("文件名白名单：放行本应用生成的形状", () => {
  for (const ok of ["abc123.png", "0f3e9a.jpg", "a1.webp", "x.svg", "id.vnd.microsoft.icon", "ABC.PNG"]) {
    assert.ok(isSafeImageName(ok), `应放行 ${ok}`);
  }
});

test("文件名白名单：挡住路径穿越和异常输入", () => {
  for (const bad of ["../x.png", "../../.ssh/id_rsa", "a/b.png", "/etc/passwd", ".hidden.png",
                     "a..png", "a.png/..", "a\\b.png", "", "noext", null, undefined, 42]) {
    assert.ok(!isSafeImageName(bad), `应拦下 ${String(bad)}`);
  }
});

test("导出时带 ../ 的图片引用不进待复制清单，不会写到导出目录外", () => {
  const { markdown, images } = noteToMarkdown({
    title: "",
    doc: doc(img("img:../../.ssh/id_rsa", "坏"), img("img:good1.png", "好")),
  });
  assert.deepEqual(images, [{ name: "good1.png", copyFrom: "good1.png" }]);
  assert.doesNotMatch(markdown, /\.ssh/);
  assert.match(markdown, /!\[坏\]\(图片引用无效\)/);
});
