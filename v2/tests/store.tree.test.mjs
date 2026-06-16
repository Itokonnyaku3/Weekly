import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-06-16' });           // 親
const a = s.createCard({ kind:'task', content:'A', parentRefId: day.ref.id });
const b = s.createCard({ kind:'task', content:'B', parentRefId: day.ref.id });
const a1 = s.createCard({ kind:'task', content:'A-1', parentRefId: a.ref.id });

// childRefs は order 昇順
const kids = s.childRefs(day.ref.id);
assert.deepEqual(kids.map(r=>r.bodyId), [a.body.id, b.body.id]);
assert.deepEqual(kids.map(r=>r.order), [0, 1]);

// 孫は親 a の下
assert.deepEqual(s.childRefs(a.ref.id).map(r=>r.bodyId), [a1.body.id]);

// ルート直下（parentRefId=null）は day のみ
assert.deepEqual(s.childRefs(null).map(r=>r.bodyId), [day.body.id]);

// refsForBody は全出現を返す（今は各1枚）
assert.equal(s.refsForBody(a.body.id).length, 1);

// 同じ本体をもう1枚別の場所へ（ミラーの素地）→ 2枚になる
s.createRef({ bodyId: a.body.id, parentRefId: b.ref.id });
assert.equal(s.refsForBody(a.body.id).length, 2);

console.log('PASS store.tree');
