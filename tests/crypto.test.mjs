// 加密改动最怕的是：升级之后，已经上锁的老笔记用原密码解不开了。
// 所以这里重点验证「老锁（没存迭代次数、按 15 万次派生）照旧能解」。
// crypto.js 用的是 WebCrypto，Node 自带同一套 API，可以直接跑。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLock,
  verifyPassword,
  deriveKey,
  randomSalt,
  encryptJSON,
  decryptJSON,
} from "../src/crypto.js";

const VERIFY_TOKEN = "IDEAL_NOTES_UNLOCK_OK";

test("新设的密码用 60 万次，并把次数存进锁里", async () => {
  const { lock, key } = await createLock("12345678");
  assert.equal(lock.iterations, 600000);
  const again = await verifyPassword("12345678", lock);
  assert.ok(again, "正确密码应能验证通过");
  const blob = await encryptJSON(key, { a: 1 });
  assert.deepEqual(await decryptJSON(again, blob), { a: 1 });
});

test("老锁（没有 iterations 字段）照旧按 15 万次解开，老笔记不受影响", async () => {
  // 按升级前的方式造一把老锁和一条老笔记
  const salt = randomSalt();
  const oldKey = await deriveKey("1234", salt, 150000);
  const legacyLock = { salt, verifier: await encryptJSON(oldKey, VERIFY_TOKEN) };
  const oldNote = await encryptJSON(oldKey, { type: "doc", content: [{ type: "paragraph" }] });

  const key = await verifyPassword("1234", legacyLock);
  assert.ok(key, "老锁用原密码必须还能解开");
  assert.deepEqual(await decryptJSON(key, oldNote), { type: "doc", content: [{ type: "paragraph" }] });
});

test("密码错误返回 null，新老锁都一样", async () => {
  const { lock } = await createLock("right-pass");
  assert.equal(await verifyPassword("wrong-pass", lock), null);

  const salt = randomSalt();
  const oldKey = await deriveKey("1234", salt, 150000);
  const legacyLock = { salt, verifier: await encryptJSON(oldKey, VERIFY_TOKEN) };
  assert.equal(await verifyPassword("4321", legacyLock), null);
});
