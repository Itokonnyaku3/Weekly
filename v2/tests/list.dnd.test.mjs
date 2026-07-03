import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { canDropTask } from '../src/list.js';

const s = createStore();
const p1 = s.createProject('PJ1');
const p2 = s.createProject('PJ2');
const day = s.createCard({ kind:'day', content:'2026-07-03' });

const t1 = s.createCard({ kind:'task', content:'t1', parentRefId: day.ref.id });
s.updateBody(t1.body.id, { proj: p1.id, mid: '設計' });
const tNone = s.createCard({ kind:'task', content:'tNone', parentRefId: day.ref.id }); // 未所属

assert.equal(canDropTask(s, t1.body.id, p1.id), true, '同PJへは可');
assert.equal(canDropTask(s, t1.body.id, p2.id), false, '別PJへは不可');
assert.equal(canDropTask(s, tNone.body.id, ''), true, '未所属→未所属グループは可');
assert.equal(canDropTask(s, tNone.body.id, p1.id), false, '未所属→PJは不可');
assert.equal(canDropTask(s, 'no-id', p1.id), false, '存在しないタスクは不可');

console.log('PASS list.dnd');
