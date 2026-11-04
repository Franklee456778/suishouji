import { test } from "node:test";
import assert from "node:assert/strict";
import { shortLinkText } from "../src/linktext.js";

test("去掉协议、www、查询串和结尾斜杠", () => {
  assert.equal(shortLinkText("https://www.example.com/a/b/?x=1#top"), "example.com/a/b");
  assert.equal(shortLinkText("https://example.com/"), "example.com");
});

test("太长的截到 30 个字符，开头的网站名保留", () => {
  const out = shortLinkText("https://github.com/" + "a".repeat(80));
  assert.equal(out, "github.com/" + "a".repeat(19) + "…");
});

test("编码过的中文路径显示成中文", () => {
  assert.equal(shortLinkText("https://example.com/%E7%AC%94%E8%AE%B0"), "example.com/笔记");
});

test("解不开的网址不报错", () => {
  assert.equal(shortLinkText("https://example.com/%E0%A4%A"), "example.com/%E0%A4%A");
  assert.equal(shortLinkText("not a url"), "not a url");
});
