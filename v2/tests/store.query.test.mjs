import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const s = createStore();

// ensureDayCard: 無ければ作る・あれば同じものを返す（重複生成しない）
const d1 = s.ensureDayCard('2026-06-16');
assert.equal(d1.body.kind, 'day');
assert.equal(d1.body.content, '2026-06-16');
assert.equal(d1.ref.parentRefId, null);
const d2 = s.ensureDayCard('2026-06-16');
assert.equal(d2.body.id, d1.body.id, '同じ日付は同じ本体');
assert.equal(s.queryBodies(b => b.kind==='day').length, 1, '重複しない');

// queryBodies: 述語でフィルタ（リストビューのレンズ土台）
s.createCard({ kind:'task', content:'未', parentRefId:d1.ref.id });
s.createCard({ kind:'task', content:'済', parentRefId:d1.ref.id, done:true });
s.createCard({ kind:'memo', content:'メモ', parentRefId:d1.ref.id });

const tasks = s.queryBodies(b => b.kind==='task');
assert.equal(tasks.length, 2);
const open = s.queryBodies(b => b.kind==='task' && !b.done);
assert.equal(open.length, 1);
assert.equal(open[0].content, '未');

console.log('PASS store.query');
