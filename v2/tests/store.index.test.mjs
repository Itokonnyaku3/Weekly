import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

// 親→子 / body→ref の索引が create/update(reparent)/delete と状態差し替えで整合し続けることを守る。
const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-07-01' });
const a = s.createCard({ kind:'task', content:'A', parentRefId: day.ref.id });
const b = s.createCard({ kind:'task', content:'B', parentRefId: day.ref.id });

// 初期: day 直下に a,b
assert.deepEqual(s.childRefs(day.ref.id).map(r=>r.id), [a.ref.id, b.ref.id]);

// reparent: b を a の下へ（updateRef で parentRefId 変更）→ 索引が張り替わる
s.updateRef(b.ref.id, { parentRefId: a.ref.id });
assert.deepEqual(s.childRefs(day.ref.id).map(r=>r.id), [a.ref.id]);
assert.deepEqual(s.childRefs(a.ref.id).map(r=>r.id), [b.ref.id]);

// 同一 body の 2枚目 ref を別の場所に → refsForBody が両方返す
const b2 = s.createRef({ bodyId: b.body.id, parentRefId: day.ref.id });
assert.equal(s.refsForBody(b.body.id).length, 2);

// delete: 1枚外すと索引から消える（もう片方は残る＝body は GC されない）
s.deleteRef(b2.id);
assert.equal(s.refsForBody(b.body.id).length, 1);
assert.equal(s.getBody(b.body.id).content, 'B');

// undo で ref の同一性が変わっても索引が作り直される（childRefs が壊れない）
s.commitHistory();
const c = s.createCard({ kind:'task', content:'C', parentRefId: day.ref.id });
s.commitHistory();
assert.deepEqual(s.childRefs(day.ref.id).map(r=>r.bodyId), [a.body.id, c.body.id]);
s.undo();
assert.deepEqual(s.childRefs(day.ref.id).map(r=>r.bodyId), [a.body.id]);
assert.equal(s.refsForBody(c.body.id).length, 0);

// replaceState 後も索引が新 state から再構築される
s.replaceState({ v:1, seq:0, bodies:{ b1:{id:'b1',kind:'day',content:'d'} },
  refs:{ r1:{id:'r1',bodyId:'b1',parentRefId:null,order:0} }, views:[] });
assert.deepEqual(s.childRefs(null).map(r=>r.id), ['r1']);
assert.equal(s.refsForBody('b1').length, 1);

console.log('PASS store.index');
