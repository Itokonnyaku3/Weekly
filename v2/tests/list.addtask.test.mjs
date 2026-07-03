import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { addTaskToday } from '../src/list.js';

const today = '2026-07-03';
const s = createStore();
const p1 = s.createProject('PJ1');

// PJ+mid 継承でタスク作成（今日の day カード直下）
const r1 = addTaskToday(s, { proj: p1.id, mid: '設計' }, today);
const b1 = s.getBody(r1.body.id);
assert.equal(b1.kind, 'task', 'kind=task');
assert.equal(b1.proj, p1.id, 'proj継承');
assert.equal(b1.mid, '設計', 'mid継承');

// 親は今日の day カード
const dayBody = s.queryBodies(x => x.kind === 'day' && x.content === today)[0];
assert.ok(dayBody, '今日の day カードが存在');
const dayRef = s.refsForBody(dayBody.id).find(r => r.parentRefId === null);
assert.equal(s.getRef(r1.ref.id).parentRefId, dayRef.id, '今日の day 直下');

// 同日に2件目→同じ day カード配下
const r2 = addTaskToday(s, { proj: p1.id, mid: '実装' }, today);
assert.equal(s.getRef(r2.ref.id).parentRefId, dayRef.id, '同じ day 配下に並ぶ');
assert.equal(s.queryBodies(x => x.kind === 'day' && x.content === today).length, 1, 'day カードは1つ');

// proj/mid 省略時は未設定
const r3 = addTaskToday(s, {}, today);
assert.equal(s.getBody(r3.body.id).proj, undefined, 'proj未指定');
assert.equal(s.getBody(r3.body.id).mid, undefined, 'mid未指定');

console.log('PASS list.addtask');
