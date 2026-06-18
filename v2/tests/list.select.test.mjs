import assert from 'node:assert/strict';
import { selectTasks } from '../src/list.js';

const today = '2026-06-17';
const tasks = [
  { id:'1', content:'A', due:'2026-06-18', prio:1, createdAt:'2026-06-01T00:00:00Z' }, // +1日
  { id:'2', content:'B', due:'2026-06-25', prio:3, createdAt:'2026-06-02T00:00:00Z' }, // +8日
  { id:'3', content:'C', due:'2026-06-10', prio:0, done:true, createdAt:'2026-06-03T00:00:00Z' }, // -7日(期限切れ・完了)
  { id:'4', content:'D', createdAt:'2026-06-04T00:00:00Z' },                            // 期限なし
];

// 今後3日以内 → A のみ
assert.deepEqual(selectTasks(tasks, { dueFilter:'next3', sort:'due' }, today).map(t=>t.id), ['1']);
// 期限切れ → C
assert.deepEqual(selectTasks(tasks, { dueFilter:'overdue' }, today).map(t=>t.id), ['3']);
// 今日まで（期限切れ含む）→ C
assert.deepEqual(selectTasks(tasks, { dueFilter:'today' }, today).map(t=>t.id), ['3']);
// 期限なし → D
assert.deepEqual(selectTasks(tasks, { dueFilter:'none' }, today).map(t=>t.id), ['4']);
// 期限あり → A,B,C（期限昇順）
assert.deepEqual(selectTasks(tasks, { dueFilter:'has', sort:'due' }, today).map(t=>t.id), ['3','1','2']);

// 完了を隠す＋期限昇順（期限なしは末尾）
assert.deepEqual(selectTasks(tasks, { hideDone:true, dueFilter:'all', sort:'due' }, today).map(t=>t.id), ['1','2','4']);

// 優先度降順（高い順）: B(3) が先頭
assert.equal(selectTasks(tasks, { sort:'priority' }, today)[0].id, '2');

// 作成日昇順
assert.deepEqual(selectTasks(tasks, { sort:'created' }, today).map(t=>t.id), ['1','2','3','4']);

// projFilter（プロジェクト帰属）
const pj = [
  { id:'a', content:'A', proj:'p1', createdAt:'2026-06-01T00:00:00Z' },
  { id:'b', content:'B', proj:'p2', createdAt:'2026-06-02T00:00:00Z' },
  { id:'c', content:'C',            createdAt:'2026-06-03T00:00:00Z' }, // 未割当
];
assert.deepEqual(selectTasks(pj, { projFilter:'p1', sort:'created' }, today).map(t=>t.id), ['a']);
assert.deepEqual(selectTasks(pj, { projFilter:'none', sort:'created' }, today).map(t=>t.id), ['c']);
assert.deepEqual(selectTasks(pj, { projFilter:'all',  sort:'created' }, today).map(t=>t.id), ['a','b','c']);

console.log('PASS list.select');
