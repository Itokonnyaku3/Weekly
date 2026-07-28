import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { buildWeeklyGrid, weeksFor, cellSorter, SORT_MODES } from '../src/week.js';

const TODAY = '2026-07-22';                  // 水曜・今週=2026-07-20
const WEEKS = weeksFor(TODAY);
const CUR = '2026-07-20';
const s = createStore();
const P = s.createProject('PJ.HACCP');

// 出所日が違う／期限は全部同じ＝既定では「出所日」で順序が決まる（＝見た目バラバラの原因）
const d20 = s.ensureDayCard('2026-07-20');
const d21 = s.ensureDayCard('2026-07-21');
const d22 = s.ensureDayCard('2026-07-22');
const mk = (day, content, attrs = {}) =>
  s.createCard({ kind:'task', content, due:'2026-07-24', parentRefId: day.ref.id, proj: P.id, ...attrs });

mk(d22, 'かきくけこ', { createdAt:'2026-07-22T01:00:00.000Z' });
mk(d20, 'さしすせそ', { createdAt:'2026-07-20T01:00:00.000Z' });
mk(d21, 'あいうえお', { createdAt:'2026-07-21T01:00:00.000Z' });

const todoOf = (sort) =>
  buildWeeklyGrid(s, { weeks: WEEKS, today: TODAY, sort }).rows[0].cells[CUR].todo.map(e => e.body.content);

// 既定: 期限が同じなので出所日順（従来どおり＝デグレなし）
assert.deepEqual(todoOf('default'), ['さしすせそ', 'あいうえお', 'かきくけこ']);
assert.deepEqual(todoOf(), ['さしすせそ', 'あいうえお', 'かきくけこ'], 'sort未指定は既定');
assert.deepEqual(todoOf('こわれた値'), ['さしすせそ', 'あいうえお', 'かきくけこ'], '未知のモードは既定に落ちる');

// 名前順: 出所日に関係なく五十音順
assert.deepEqual(todoOf('name'), ['あいうえお', 'かきくけこ', 'さしすせそ']);
// 新しい順: createdAt の降順
assert.deepEqual(todoOf('new'), ['かきくけこ', 'あいうえお', 'さしすせそ']);

// 数字は数値として比較（項目2 < 項目10。文字列比較なら逆になる）
const s2 = createStore();
const Q = s2.createProject('PJ.N');
const dd = s2.ensureDayCard(TODAY);
for (const t of ['項目10', '項目2', '項目1']) s2.createCard({ kind:'task', content:t, parentRefId: dd.ref.id, proj: Q.id });
const byName = buildWeeklyGrid(s2, { weeks: WEEKS, today: TODAY, sort:'name' }).rows[0].cells[CUR].todo;
assert.deepEqual(byName.map(e => e.body.content), ['項目1', '項目2', '項目10']);

// 期限順: 期限なしは後ろ／同じ期限は名前で決着
const s3 = createStore();
const R = s3.createProject('PJ.D');
const d3 = s3.ensureDayCard(TODAY);
s3.createCard({ kind:'task', content:'ぬ 期限なし', parentRefId: d3.ref.id, proj: R.id, gridWk: CUR });
s3.createCard({ kind:'task', content:'い 24日', due:'2026-07-24', parentRefId: d3.ref.id, proj: R.id });
s3.createCard({ kind:'task', content:'あ 24日', due:'2026-07-24', parentRefId: d3.ref.id, proj: R.id });
s3.createCard({ kind:'task', content:'う 22日', due:'2026-07-22', parentRefId: d3.ref.id, proj: R.id });
assert.deepEqual(
  buildWeeklyGrid(s3, { weeks: WEEKS, today: TODAY, sort:'due' }).rows[0].cells[CUR].todo.map(e => e.body.content),
  ['う 22日', 'あ 24日', 'い 24日', 'ぬ 期限なし']);

// 名前の比較は表示テキスト（#マイルストーン を除いた形）で行う
const cmp = cellSorter('name', 'todo');
const e = (content) => ({ body: { id:'b1', content }, day:null, wk:null });
assert.ok(cmp(e('あ #マイルストーン'), e('い')) < 0, 'タグを外した「あ」で比較する');

// モード一覧（UIのセレクタ）に既定が含まれる
assert.equal(SORT_MODES[0][0], 'default');
assert.deepEqual(SORT_MODES.map(m => m[0]), ['default', 'name', 'due', 'new']);

console.log('PASS week.sort');
