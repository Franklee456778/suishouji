// 子文件夹的树逻辑测试。
//
// store.js 依赖浏览器环境（db.js 用 window），没法直接 import，
// 所以这里把树算法单独抽出来测——这几条是最容易写错、出错代价最大的：
// 防环写漏 → 整棵子树从界面上消失；子孙集合算错 → 删除时误删或漏删笔记。

import { test } from "node:test";
import assert from "node:assert/strict";

// 与 store.js 中 descendantIds / folderTree / moveFolder 的判定逻辑一致
function descendantIds(folders, id) {
  const out = new Set([id]);
  const walk = (pid) => {
    folders.forEach((f) => {
      if ((f.parentId || null) === pid && !out.has(f.id)) {
        out.add(f.id);
        walk(f.id);
      }
    });
  };
  walk(id);
  return out;
}

function folderTree(folders) {
  const out = [];
  const kids = (pid) => folders.filter((f) => (f.parentId || null) === (pid || null));
  const walk = (pid, depth) => {
    kids(pid).forEach((f) => {
      out.push({ name: f.name, depth, hasChildren: kids(f.id).length > 0 });
      walk(f.id, depth + 1);
    });
  };
  walk(null, 0);
  return out;
}

function canMove(folders, id, target) {
  const f = folders.find((x) => x.id === id);
  if (!f) return false;
  const t = target || null;
  if (t === (f.parentId || null)) return false;      // 没变化
  if (t && descendantIds(folders, id).has(t)) return false; // 防环
  return true;
}

// 工作 > 项目A > 阶段一；工作 > 项目B；私人
const tree = () => [
  { id: "w", name: "工作", parentId: null },
  { id: "a", name: "项目A", parentId: "w" },
  { id: "s", name: "阶段一", parentId: "a" },
  { id: "b", name: "项目B", parentId: "w" },
  { id: "p", name: "私人", parentId: null },
];

test("拍平后的顺序和层级正确", () => {
  assert.deepEqual(folderTree(tree()), [
    { name: "工作", depth: 0, hasChildren: true },
    { name: "项目A", depth: 1, hasChildren: true },
    { name: "阶段一", depth: 2, hasChildren: false },
    { name: "项目B", depth: 1, hasChildren: false },
    { name: "私人", depth: 0, hasChildren: false },
  ]);
});

test("子孙集合包含自己，且能穿透多层", () => {
  assert.deepEqual([...descendantIds(tree(), "w")].sort(), ["a", "b", "s", "w"]);
  assert.deepEqual([...descendantIds(tree(), "a")].sort(), ["a", "s"]);
  assert.deepEqual([...descendantIds(tree(), "s")], ["s"]);
});

test("不能移到自己下面（会成环）", () => {
  assert.equal(canMove(tree(), "w", "w"), false);
});

test("不能移到自己的子孙下面——这条漏了整棵子树会消失", () => {
  assert.equal(canMove(tree(), "w", "a"), false, "移到直接子级");
  assert.equal(canMove(tree(), "w", "s"), false, "移到隔一层的子孙");
});

test("移到无关分支 / 顶层是允许的", () => {
  assert.equal(canMove(tree(), "a", "p"), true);
  assert.equal(canMove(tree(), "s", null), true);
});

test("移到当前所在的父级 = 无变化，应拒绝", () => {
  assert.equal(canMove(tree(), "a", "w"), false);
  assert.equal(canMove(tree(), "p", null), false);
});

test("父级不存在的孤儿文件夹要当成顶层，不能从树里消失", () => {
  const orphaned = [
    { id: "x", name: "孤儿", parentId: "已删除的id" },
    { id: "y", name: "正常", parentId: null },
  ];
  // 迁移逻辑：父级不在了就提到顶层
  const ids = new Set(orphaned.map((f) => f.id));
  orphaned.forEach((f) => {
    if (f.parentId && !ids.has(f.parentId)) f.parentId = null;
  });
  assert.deepEqual(
    folderTree(orphaned).map((x) => x.name),
    ["孤儿", "正常"]
  );
});
