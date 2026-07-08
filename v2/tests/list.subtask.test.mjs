import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { subtaskIndex } from '../src/list.js';

// 階層を組み立てて subtaskIndex を検証する。
// day
//  ├ タスクA
//  │   ├ タスクB          (Aの子タスク=サブタスク)
//  │   │   └ タスクC      (孫タスク=サブタスク)
//  │   └ メモM
//  │       └ タスクD      (祖先にAがいる=サブタスク)
//  └ タスクE               (トップレベル・子なし)
const s = createStore();
const { ref: dayRef } = s.ensureDayCard('2026-07-08');
const A = s.createCard({ kind:'task', content:'A', parentRefId: dayRef.id });
const B = s.createCard({ kind:'task', content:'B', parentRefId: A.ref.id });
const C = s.createCard({ kind:'task', content:'C', parentRefId: B.ref.id });
const M = s.createCard({ kind:'memo', content:'M', parentRefId: A.ref.id });
const D = s.createCard({ kind:'task', content:'D', parentRefId: M.ref.id });
const E = s.createCard({ kind:'task', content:'E', parentRefId: dayRef.id });

const { subtaskIds, descCount } = subtaskIndex(s);

// サブタスク集合: B, C, D（祖先にタスクがある）。A・E はトップレベルなので含まれない。
assert.ok(subtaskIds.has(B.body.id),  'B はサブタスク');
assert.ok(subtaskIds.has(C.body.id),  'C はサブタスク（孫）');
assert.ok(subtaskIds.has(D.body.id),  'D はサブタスク（メモ越しでも祖先にAがいる）');
assert.ok(!subtaskIds.has(A.body.id), 'A はサブタスクでない');
assert.ok(!subtaskIds.has(E.body.id), 'E はサブタスクでない');
assert.equal(subtaskIds.size, 3, 'サブタスクは3件');

// 配下子孫タスク数（孫含む・メモは数えずメモ配下のタスクは数える）
assert.equal(descCount.get(A.body.id), 3, 'A の配下タスクは B・C・D の3件');
assert.equal(descCount.get(B.body.id), 1, 'B の配下タスクは C の1件');
assert.equal(descCount.has(C.body.id), false, 'C は配下タスクなし→未格納');
assert.equal(descCount.has(E.body.id), false, 'E は配下タスクなし→未格納');
assert.equal(descCount.get(M.body.id), 1, 'メモM配下のタスクD=1（UIではタスク行のみ参照するがカウント自体は正しい）');

console.log('PASS list.subtask');
