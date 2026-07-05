import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { cascadeCollapse, cascadeExpand } from '../src/daily.js';

// ツリー: R > A > A1 > A1a  （R,A,A1 は子を持つ）
const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-07-05' });
const R  = s.createCard({ kind:'memo', content:'R',  parentRefId: day.ref.id });
const A  = s.createCard({ kind:'memo', content:'A',  parentRefId: R.ref.id });
const A1 = s.createCard({ kind:'memo', content:'A1', parentRefId: A.ref.id });
s.createCard({ kind:'memo', content:'A1a', parentRefId: A1.ref.id });

const col = (ref) => !!s.getRef(ref.ref.id).collapsed;

// 段階的に深い所から畳む
assert.equal(cascadeCollapse(s, R.ref.id), true, '1回目: 畳めた');
assert.deepEqual([col(R), col(A), col(A1)], [false, false, true], '最深(A1)から畳む');
assert.equal(cascadeCollapse(s, R.ref.id), true, '2回目');
assert.deepEqual([col(R), col(A), col(A1)], [false, true, true], '次にA');
assert.equal(cascadeCollapse(s, R.ref.id), true, '3回目');
assert.deepEqual([col(R), col(A), col(A1)], [true, true, true], '最後にR');
assert.equal(cascadeCollapse(s, R.ref.id), false, 'これ以上畳めない→false');

// 段階的に浅い所から開く
assert.equal(cascadeExpand(s, R.ref.id), true, '展開1回目');
assert.deepEqual([col(R), col(A), col(A1)], [false, true, true], '最浅(R)から開く');
assert.equal(cascadeExpand(s, R.ref.id), true, '展開2回目');
assert.deepEqual([col(R), col(A), col(A1)], [false, false, true], '次にA');
assert.equal(cascadeExpand(s, R.ref.id), true, '展開3回目');
assert.deepEqual([col(R), col(A), col(A1)], [false, false, false], '最後にA1');
assert.equal(cascadeExpand(s, R.ref.id), false, 'これ以上開けない→false');

// 子を持たないノードは畳めない
const leaf = s.createCard({ kind:'memo', content:'leaf', parentRefId: day.ref.id });
assert.equal(cascadeCollapse(s, leaf.ref.id), false, '葉は畳めない');

console.log('PASS daily.cascade');
