import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { buildWeeklyGrid, weeksFor } from '../src/week.js';

const TODAY = '2026-07-22';                  // 今週=2026-07-20
const WEEKS = weeksFor(TODAY);               // 07-13, 07-20, 07-27, 08-03, 08-10, 08-17
const s = createStore();
const P = s.createProject('P');
s.ensureProjectPage(P.id);

// 3週前の日に書いた未完了タスク（表示範囲の外＝07-13 より前）
const dOld = s.ensureDayCard('2026-07-01');   // 週=2026-06-29
const old = s.createCard({ kind:'task', content:'ずっと未完了', parentRefId: dOld.ref.id, proj: P.id });

// 先週の未完了タスク
const dPrev = s.ensureDayCard('2026-07-15');  // 週=2026-07-13
s.createCard({ kind:'task', content:'先週の未完了', parentRefId: dPrev.ref.id, proj: P.id });

// 先週のマイルストーン（未完了）→ 繰越しない
s.createCard({ kind:'task', content:'MS #マイルストーン', parentRefId: dPrev.ref.id, proj: P.id });

// 先週のメモ → 繰越しない
s.createCard({ kind:'memo', content:'先週のメモ', parentRefId: dPrev.ref.id, proj: P.id });

let g = buildWeeklyGrid(s, { weeks: WEEKS, today: TODAY });
let row = g.rows[0];
const overOf = (wk) => row.cells[wk].over.map(e => e.body.content).sort();

// 所属週 < 対象週 ≤ 今週 の各週に出る
assert.deepEqual(overOf('2026-07-13'), ['ずっと未完了'], '表示範囲外の週の分も先週へ繰り越す');
assert.deepEqual(overOf('2026-07-20'), ['ずっと未完了', '先週の未完了'], '今週に両方出る');
assert.deepEqual(overOf('2026-07-27'), [], '未来週には期限切れを出さない');
assert.deepEqual(overOf('2026-08-03'), []);

// 元の週のセルにも残る（履歴が消えない）
assert.deepEqual(row.cells['2026-07-13'].todo.map(e => e.body.content).sort(),
  ['先週の未完了'], '元の週には todo として残る');

// マイルストーン・メモは繰越の対象外
assert.equal(row.cells['2026-07-20'].over.some(e => e.body.content.includes('マイルストーン')), false);
assert.equal(row.cells['2026-07-20'].over.some(e => e.body.content === '先週のメモ'), false);

// 完了すると繰越が止まる
s.updateBody(old.body.id, { done:true });
g = buildWeeklyGrid(s, { weeks: WEEKS, today: TODAY });
row = g.rows[0];
assert.equal(row.cells['2026-07-20'].over.some(e => e.body.content === 'ずっと未完了'), false,
  '完了したら繰越が消える');
assert.deepEqual(row.cells['2026-07-20'].over.map(e => e.body.content), ['先週の未完了']);

// 期限を来週にずらすと、今週の繰越から消える（所属週が未来になる）
const prevTask = row.cells['2026-07-13'].todo[0];
s.updateBody(prevTask.body.id, { due:'2026-07-30' });
g = buildWeeklyGrid(s, { weeks: WEEKS, today: TODAY });
row = g.rows[0];
assert.deepEqual(row.cells['2026-07-20'].over, [], '期限を先送りすると期限切れではなくなる');
assert.deepEqual(row.cells['2026-07-27'].todo.map(e => e.body.content), ['先週の未完了'],
  '期限の週に移る');

console.log('PASS week.over');
