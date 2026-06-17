import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-06-17' });
const a = s.createCard({ kind:'task', content:'A', parentRefId: day.ref.id });
const b = s.createCard({ kind:'task', content:'B', parentRefId: day.ref.id });
const c = s.createCard({ kind:'task', content:'C', parentRefId: day.ref.id });

// prevSiblingRef
assert.equal(s.prevSiblingRef(a.ref.id), null, 'A は先頭で前兄弟なし');
assert.equal(s.prevSiblingRef(b.ref.id).id, a.ref.id);

// orderAfter: B と C の間 / 末尾は +1
const oa = s.orderAfter(b.ref.id);
assert.ok(oa > b.ref.order && oa < c.ref.order, 'B と C の間に入る order');
assert.equal(s.orderAfter(c.ref.id), c.ref.order + 1);

// 分割（Enter）相当: B の直後に B2 を挿入しても並びは A,B,B2,C
const b2 = s.createCard({ kind:'task', content:'B2', parentRefId: day.ref.id, order: s.orderAfter(b.ref.id) });
assert.deepEqual(s.childRefs(day.ref.id).map(r=>s.getBody(r.bodyId).content), ['A','B','B2','C']);

// インデント（Tab）: B2 を B の子へ
s.updateRef(b2.ref.id, { parentRefId: b.ref.id, order: s.endOrder(b.ref.id) });
assert.deepEqual(s.childRefs(b.ref.id).map(r=>s.getBody(r.bodyId).content), ['B2']);
assert.deepEqual(s.childRefs(day.ref.id).map(r=>s.getBody(r.bodyId).content), ['A','B','C']);

// アウトデント（Shift+Tab）: B2 を B の直後の日直下へ戻す
const pRef = s.getRef(s.getRef(b2.ref.id).parentRefId); // = B
s.updateRef(b2.ref.id, { parentRefId: pRef.parentRefId, order: s.orderAfter(pRef.id) });
assert.deepEqual(s.childRefs(day.ref.id).map(r=>s.getBody(r.bodyId).content), ['A','B','B2','C'], 'B の直後に戻る');
assert.equal(s.childRefs(b.ref.id).length, 0);

console.log('PASS store.struct');
