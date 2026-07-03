import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { midsForProject } from '../src/list.js';

const s = createStore();
const p1 = s.createProject('PJ1');
const p2 = s.createProject('PJ2');
const day = s.createCard({ kind:'day', content:'2026-07-03' });

// PJ1 に中項目「設計」「実装」、PJ2 に「試験」、未所属に「雑務」
const mk = (proj, mid) => { const t = s.createCard({ kind:'task', content:'t', parentRefId: day.ref.id });
  s.updateBody(t.body.id, { proj, mid }); return t; };
mk(p1.id, '設計'); mk(p1.id, '実装'); mk(p1.id, '設計'); // 重複
mk(p2.id, '試験');
mk(undefined, '雑務');

assert.deepEqual(midsForProject(s, p1.id), ['実装','設計'], 'PJ1の中項目のみ・重複排除・ソート');
assert.deepEqual(midsForProject(s, p2.id), ['試験'], 'PJ2の中項目のみ');
assert.deepEqual(midsForProject(s, ''), ['雑務'], '未所属(proj空)の中項目');
assert.deepEqual(midsForProject(s, 'no-such-id'), [], '該当なしは空配列');

console.log('PASS list.midsuggest');
