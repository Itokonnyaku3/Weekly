import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { buildWeeklyGrid, weeksFor } from '../src/week.js';

const TODAY = '2026-07-22';                  // 水曜・今週=2026-07-20
const WEEKS = weeksFor(TODAY);               // ['2026-07-13','2026-07-20',…,'2026-08-17']
const s = createStore();

const P = s.createProject('PJ.HACCP');
const Q = s.createProject('PJ.Other');
const page = s.ensureProjectPage(P.id);

// PJ直下ノード（PJ列に出る）＋「リンク」ノードの子（リンク列に出る）
const situ = s.createCard({ kind:'memo', content:'全体状況', parentRefId: page.ref.id });
const lk = s.createCard({ kind:'memo', content:'リンク', parentRefId: page.ref.id });
s.createCard({ kind:'memo', content:'運用開始計画', url:'https://example.com/a', parentRefId: lk.ref.id });
s.createCard({ kind:'memo', content:'SP外部社', parentRefId: lk.ref.id });

// デイリー: 今週のタスク（PJ割当）＋その子（同PJ＝子は拾わない）
const d1 = s.ensureDayCard('2026-07-22');
const t1 = s.createCard({ kind:'task', content:'標準温度の確認', parentRefId: d1.ref.id, proj: P.id });
s.createCard({ kind:'task', content:'子タスク', parentRefId: t1.ref.id, proj: P.id });

// 期限が来週 → 来週のセルに入る
s.createCard({ kind:'task', content:'見積依頼', due:'2026-07-30', parentRefId: d1.ref.id, proj: P.id });

// メモ（議事録）→ 書かれた週のメモブロック
s.createCard({ kind:'memo', content:'議事録: キックオフ', parentRefId: d1.ref.id, proj: P.id });

// マイルストーン（期限あり）→ ms ブロック
s.createCard({ kind:'task', content:'運用開始 #マイルストーン', due:'2026-08-05',
               parentRefId: d1.ref.id, proj: P.id });

// 先週やって先週完了 → 先週の done
const d0 = s.ensureDayCard('2026-07-15');
const done0 = s.createCard({ kind:'task', content:'先週やった', parentRefId: d0.ref.id, proj: P.id });
s.updateBody(done0.body.id, { done:true });
s.updateBody(done0.body.id, { doneAt:'2026-07-16T10:00:00.000Z' });

// 先週に計画して今週完了 → 「やったこと」は完了週（今週）に入る
const slip = s.createCard({ kind:'task', content:'遅れて完了', parentRefId: d0.ref.id, proj: P.id });
s.updateBody(slip.body.id, { done:true });
s.updateBody(slip.body.id, { doneAt:'2026-07-22T10:00:00.000Z' });

// PJページ内のカード（直下ノードの配下）→ セルには入らない（PJページで見えているため）
s.createCard({ kind:'task', content:'ページ内タスク', parentRefId: situ.ref.id, proj: P.id });

// 別PJ → 別の行
s.createCard({ kind:'task', content:'他PJ', parentRefId: d1.ref.id, proj: Q.id });

// 未割当の未完了タスク → 未割当行
s.createCard({ kind:'task', content:'割当漏れ', parentRefId: d1.ref.id });
// 未割当だが完了 → 未割当行には出さない
const uDone = s.createCard({ kind:'task', content:'未割当だが完了', parentRefId: d1.ref.id });
s.updateBody(uDone.body.id, { done:true });
// 未割当メモ → 未割当行には出さない（タスクのみ）
s.createCard({ kind:'memo', content:'ただのメモ', parentRefId: d1.ref.id });
// 割当済みタスクのサブタスク（自身は未割当）→ 未割当行には出さない
s.createCard({ kind:'task', content:'割当済みの子', parentRefId: t1.ref.id });

const g = buildWeeklyGrid(s, { weeks: WEEKS, today: TODAY });

// ── 週ヘッダ ──
assert.equal(g.weeks.length, 6);
assert.equal(g.weeks[1].wk, '2026-07-20');
assert.equal(g.weeks[1].isCurrent, true, '今週にフラグが立つ');
assert.equal(g.weeks[0].isCurrent, false);
assert.equal(g.weeks[1].label, '7/20〜7/26');

// ── 行の並び（PJ一覧の順）＋末尾に未割当行 ──
assert.deepEqual(g.rows.map(r => r.projId), [P.id, Q.id, null], 'PJ一覧順＋未割当行は末尾');

const rowP = g.rows[0];
// ── PJ列: 直下ノード（「リンク」ノードは除外）──
assert.deepEqual(rowP.kids.map(k => k.body.content), ['全体状況'], '「リンク」ノード自体は kids に入らない');
// ── リンク列: 「リンク」ノードの子 ──
assert.deepEqual(rowP.links.map(l => l.body.content), ['運用開始計画', 'SP外部社']);
assert.equal(rowP.links[0].body.url, 'https://example.com/a');

// ── セルの分類 ──
const cur = rowP.cells['2026-07-20'], next = rowP.cells['2026-07-27'], prev = rowP.cells['2026-07-13'];
assert.deepEqual(cur.todo.map(e => e.body.content), ['標準温度の確認'], '子タスクは拾わない（最上位のみ）');
assert.deepEqual(cur.memo.map(e => e.body.content), ['議事録: キックオフ']);
assert.deepEqual(cur.done.map(e => e.body.content), ['遅れて完了'], 'やったこと＝完了週');
assert.deepEqual(prev.done.map(e => e.body.content), ['先週やった']);
assert.deepEqual(next.todo.map(e => e.body.content), ['見積依頼'], '期限のある週に入る');
assert.deepEqual(rowP.cells['2026-08-03'].ms.map(e => e.body.content), ['運用開始 #マイルストーン'],
  'マイルストーンは ms ブロック');
assert.equal(rowP.cells['2026-08-03'].todo.length, 0, 'マイルストーンは todo に重複しない');

// ページ内カードはどのセルにも出ない
const allP = WEEKS.flatMap(w => [...rowP.cells[w].todo, ...rowP.cells[w].done,
                                 ...rowP.cells[w].memo, ...rowP.cells[w].ms]);
assert.equal(allP.some(e => e.body.content === 'ページ内タスク'), false, 'PJページ内は除外');
assert.equal(allP.some(e => e.body.content === '他PJ'), false, '別PJは混ざらない');
assert.deepEqual(g.rows[1].cells['2026-07-20'].todo.map(e => e.body.content), ['他PJ']);

// ── 未割当行 ──
const rowU = g.rows[2];
assert.equal(rowU.proj, null);
assert.deepEqual(rowU.cells['2026-07-20'].todo.map(e => e.body.content), ['割当漏れ'],
  '未割当行は未完了タスクのみ・割当済みの子孫やメモは入らない');

// ── entry の中身 ──
const e1 = cur.todo[0];
assert.equal(e1.day, '2026-07-22', '出所日');
assert.equal(e1.wk, '2026-07-20', '所属週');
assert.ok(e1.ref && e1.ref.id, 'ref を持つ');
assert.ok(e1.body && e1.body.id, 'body を持つ');

// ── total と hideEmpty ──
assert.ok(rowP.total > 0);
const empty = s.createProject('PJ.Empty');
const g2 = buildWeeklyGrid(s, { weeks: WEEKS, today: TODAY });
assert.ok(g2.rows.some(r => r.projId === empty.id), '既定では空PJも行に出る');
const g3 = buildWeeklyGrid(s, { weeks: WEEKS, today: TODAY, hideEmpty: true });
assert.equal(g3.rows.some(r => r.projId === empty.id), false, 'hideEmpty で空PJを隠す');
assert.ok(g3.rows.some(r => r.projId === P.id), 'hideEmpty でも中身のあるPJは残る');

// ── 表示範囲外の週は落とす ──
s.createCard({ kind:'task', content:'ずっと先', due:'2027-01-05', parentRefId: d1.ref.id, proj: P.id });
const g4 = buildWeeklyGrid(s, { weeks: WEEKS, today: TODAY });
const allP4 = WEEKS.flatMap(w => g4.rows[0].cells[w].todo.map(e => e.body.content));
assert.equal(allP4.includes('ずっと先'), false, '表示範囲外の週のカードは出ない');

console.log('PASS week.grid');
