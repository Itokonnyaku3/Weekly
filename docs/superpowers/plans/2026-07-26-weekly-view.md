# 週次ビュー（PJ×週マトリクス）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 縦=プロジェクト / 横=週 のマトリクスで、各週の「やること・やったこと・メモ・マイルストーン・期限切れ」を串刺し管理できる週次ビューを v2 に追加する。

**Architecture:** 派生ビュー方式。データの正はデイリー/PJページのカードのままで、`store.js` は変更しない。純ロジック（週キー計算・PJ×週の集約・カーソル移動）を `v2/src/week.js` に分離して単体テストし、`v2/src/weekly.js` が描画とイベントだけを担当する。セルは既定コンパクト行、`Alt+↓` で `daily.js` の `renderChildren` に差し替えて実体編集する。

**Tech Stack:** バニラ JS（ES modules・ビルドなし）、`node tests/*.test.mjs`（`node:assert/strict` の素のスクリプト）、静的サーバ（`python -m http.server 8123`）。

**設計spec:** `docs/superpowers/specs/2026-07-26-weekly-view-design.md`

---

## 前提知識（この作業に必要な v2 の約束事）

- **モジュール読み込み**: 各 src ファイルは先頭で `const _q = new URL(import.meta.url).search;` を作り、
  兄弟モジュールを `await import('./x.js' + _q)` で読む。開発時のキャッシュ回避のため `?v=` を伝播させる約束。
  **静的 `import` 文は使わない**（テストからは `?v=` なしで普通に import される）。
- **データモデル**: `body`（本体: `kind`/`content`/`due`/`done`/`doneAt`/`prio`/`proj`/`mid`/`props`/`url`/`createdAt`）と
  `ref`（配置: `parentRefId`/`order`/`collapsed`/`gridWk`）の2層。1つの body が複数 ref を持てる（ミラー）。
  `kind` は `'day' | 'memo' | 'task' | 'table' | 'image' | 'project'`。
- **日付は文字列** `'YYYY-MM-DD'`（辞書順＝時系列順）。`doneAt` は ISO 文字列なので `.slice(0,10)` で日付に。
- **描画の流儀**: 状態を変えたら `requestRender()` を呼び全体を作り直す（`innerHTML=''` → 再構築）。
  フォーカスは描画後に自分で復帰させる。
- **テストの流儀**: `tests/*.test.mjs` は `node:assert/strict` を使う素のスクリプト。最後に `console.log('PASS 名前')`。
  失敗時は assert が throw して非0終了。

### テストの実行コマンド（全ステップで使う）

```bash
cd v2 && for f in tests/*.test.mjs; do node "$f" || exit 1; done
```

単体で走らせるとき:

```bash
cd v2 && node tests/week.key.test.mjs
```

### 実機確認の手順（全フェーズ共通）

`preview_start` で `weekly-static`（`.claude/launch.json` に定義済み・ポート 8123）を起動し、
`http://localhost:8123/v2/index.html` を開く。確認後は `read_console_messages` でエラーが無いことを見る。

---

## File Structure

| ファイル | 責務 | 状態 |
|---|---|---|
| `v2/src/week.js` | 週キー計算 / カードの所属週 / PJ×週の集約 / カーソル移動。**DOM非依存の純ロジック** | 新規 |
| `v2/src/weekly.js` | 週次ビューの描画・キー/マウスイベント・週報コピーの組み立て | 新規 |
| `v2/tests/week.key.test.mjs` | 週キー計算のテスト | 新規 |
| `v2/tests/week.cardweek.test.mjs` | 所属週の優先順位のテスト | 新規 |
| `v2/tests/week.grid.test.mjs` | 集約（収集・除外・分類・未割当行）のテスト | 新規 |
| `v2/tests/week.over.test.mjs` | 期限切れ繰越のテスト | 新規 |
| `v2/tests/week.cursor.test.mjs` | カーソル移動のテスト | 新規 |
| `v2/tests/week.report.test.mjs` | 週報テキスト生成のテスト | 新規 |
| `v2/src/clipboard.js` | `copyRichText(html, plain)` を**追加**（既存の copy/paste 経路は触らない） | 変更 |
| `v2/src/app.js` | 週次ビューの登録・`Alt+4`・`openProjectAt`・コマンド追加・ナビ履歴に `wkOff` | 変更 |
| `v2/index.html` | ツールバーのボタンと `#view-weekly` を追加 | 変更 |
| `v2/style.css` | `.wk-*` クラス（既存クラスと衝突しない接頭辞） | 変更 |
| `v2/CHANGELOG.md` | v0.95.0 のエントリ | 変更 |

**触らないファイル**: `store.js` / `daily.js` / `list.js` / `project.js` / `query.js` / `search.js` / `props.js` / `persist.js` / `github.js` / `palette.js` / `calendar.js`

---

## Task 1: 週キー計算（`week.js` の土台）

**Files:**
- Create: `v2/src/week.js`
- Test: `v2/tests/week.key.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `v2/tests/week.key.test.mjs`:

```js
import assert from 'node:assert/strict';
import { weekStart, weekAdd, weekLabel, weeksFor, shiftDays, WEEK_COUNT, WEEK_BACK } from '../src/week.js';

// 2026-07-26 は日曜 → その週の月曜は 2026-07-20
assert.equal(weekStart('2026-07-26'), '2026-07-20', '日曜は前の月曜が週頭');
assert.equal(weekStart('2026-07-20'), '2026-07-20', '月曜はその日が週頭');
assert.equal(weekStart('2026-07-21'), '2026-07-20', '火曜');
assert.equal(weekStart('2026-07-27'), '2026-07-27', '次の月曜');
assert.equal(weekStart('2026-07-26T12:34:56.000Z'), '2026-07-20', 'ISO文字列も先頭10文字で扱う');

// 月末・年越し
assert.equal(weekStart('2026-03-01'), '2026-02-23', '月をまたぐ');
assert.equal(weekStart('2027-01-01'), '2026-12-28', '年をまたぐ（金曜→前の月曜）');

// 不正値は null（壊れた保存データでクラッシュしない）
assert.equal(weekStart(''), null);
assert.equal(weekStart(null), null);
assert.equal(weekStart('not-a-date'), null);

// 週の加減算
assert.equal(weekAdd('2026-07-20', 1), '2026-07-27');
assert.equal(weekAdd('2026-07-20', -1), '2026-07-13');
assert.equal(weekAdd('2026-12-28', 1), '2027-01-04', '年をまたぐ加算');
assert.equal(weekAdd('2026-07-20', 0), '2026-07-20');

// 日数の加減算
assert.equal(shiftDays('2026-07-20', 6), '2026-07-26');
assert.equal(shiftDays('2026-02-28', 1), '2026-03-01', '平年の2月末');

// ラベル（月曜〜日曜）
assert.equal(weekLabel('2026-07-20'), '7/20〜7/26');
assert.equal(weekLabel('2026-12-28'), '12/28〜1/3', '年をまたぐラベル');

// 表示週: 既定は 先週 〜 今週+4 の6週
const ws = weeksFor('2026-07-26');
assert.equal(WEEK_COUNT, 6);
assert.equal(WEEK_BACK, 1);
assert.equal(ws.length, 6);
assert.equal(ws[0], '2026-07-13', '先頭は先週');
assert.equal(ws[1], '2026-07-20', '2番目が今週');
assert.equal(ws[5], '2026-08-17', '末尾は今週+4');
assert.deepEqual(weeksFor('2026-07-26', 1), ws.map(w => weekAdd(w, 1)), 'offsetで週送り');
assert.deepEqual(weeksFor('2026-07-26', -2), ws.map(w => weekAdd(w, -2)));

console.log('PASS week.key');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && node tests/week.key.test.mjs`
Expected: FAIL — `Cannot find module .../src/week.js`

- [ ] **Step 3: Write minimal implementation**

Create `v2/src/week.js`:

```js
// 週次ビューの純ロジック: 週キー計算 / カードの所属週 / PJ×週の集約 / カーソル移動。
// DOM に触らない＝単体テスト可能。依存は props.js（#タグ抽出）のみ＝循環なし。
// 週は月曜始まり。週キーはその週の月曜 'YYYY-MM-DD'（辞書順＝時系列順でソートできる）。
const _q = new URL(import.meta.url).search;
const { cardTags, TAG_RE } = await import('./props.js' + _q);

export const WEEK_COUNT = 6;                  // 同時に表示する週数
export const WEEK_BACK  = 1;                  // 表示範囲に含める過去週数（先週を1つ）
export const MS_TAG = 'マイルストーン';        // マイルストーン判定に使うタグ名

const _parse = (s) => Date.parse(String(s || '').slice(0, 10) + 'T00:00:00');
const _fmt = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};
// 日数の加減算。ミリ秒加算ではなく setDate を使う（夏時間のある環境でもズレない）
export function shiftDays(dateStr, n){
  const t = _parse(dateStr);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t); d.setDate(d.getDate() + n); return _fmt(d);
}
// その日が属する週の月曜（不正値は null＝壊れた保存データでクラッシュしない）
export function weekStart(dateStr){
  const t = _parse(dateStr);
  if (!Number.isFinite(t)) return null;
  const dy = new Date(t).getDay();                       // 0=日曜
  return shiftDays(dateStr, -(dy === 0 ? 6 : dy - 1));
}
export function weekAdd(wk, n){ return shiftDays(wk, n * 7); }
export function weekLabel(wk){
  const a = new Date(_parse(wk)), b = new Date(_parse(shiftDays(wk, 6)));
  return (a.getMonth() + 1) + '/' + a.getDate() + '〜' + (b.getMonth() + 1) + '/' + b.getDate();
}
// 表示する週キーの配列。offset=0 で [今週-WEEK_BACK … ] の WEEK_COUNT 週
export function weeksFor(today, offset = 0){
  const base = weekAdd(weekStart(today), offset - WEEK_BACK);
  return Array.from({ length: WEEK_COUNT }, (_, i) => weekAdd(base, i));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && node tests/week.key.test.mjs`
Expected: `PASS week.key`

- [ ] **Step 5: Run the whole suite (回帰なし確認)**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f" || exit 1; done`
Expected: 既存33本＋新規1本すべて `PASS ...`（非0終了しない）

- [ ] **Step 6: Commit**

```bash
git add v2/src/week.js v2/tests/week.key.test.mjs
git commit -m "feat(v2): 週次ビューの週キー計算（week.js 新規・月曜始まり/6週）"
```

---

## Task 2: カードの所属週とマイルストーン判定

**Files:**
- Modify: `v2/src/week.js`（末尾に追記）
- Test: `v2/tests/week.cardweek.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `v2/tests/week.cardweek.test.mjs`:

```js
import assert from 'node:assert/strict';
import { cardWeekOf, isMilestone, toggleMsContent, MS_TAG } from '../src/week.js';

// ── 所属週の優先順位: ref.gridWk > body.due > 出所日 > createdAt ──
const day = '2026-07-22';        // 水曜（週=2026-07-20）

assert.equal(cardWeekOf({ due:'2026-08-05' }, { gridWk:'2026-09-07' }, day), '2026-09-07',
  'gridWk が最優先');
assert.equal(cardWeekOf({ due:'2026-08-05' }, {}, day), '2026-08-03',
  '期限があればその期限の週');
assert.equal(cardWeekOf({}, {}, day), '2026-07-20',
  '期限がなければ書き込まれた日の週');
assert.equal(cardWeekOf({ createdAt:'2026-06-10T09:00:00.000Z' }, {}, null), '2026-06-08',
  '出所日が取れなければ作成日の週');
assert.equal(cardWeekOf({}, {}, null), null, '何も手がかりが無ければ null');
assert.equal(cardWeekOf({}, null, day), '2026-07-20', 'ref が無くても落ちない');

// ── マイルストーン判定（本文の #マイルストーン タグ）──
assert.equal(MS_TAG, 'マイルストーン');
assert.equal(isMilestone({ content:'運用開始 #マイルストーン' }), true);
assert.equal(isMilestone({ content:'#マイルストーン 運用開始' }), true);
assert.equal(isMilestone({ content:'運用開始' }), false);
assert.equal(isMilestone({ content:'#マイルストーン2 運用開始' }), false, '別タグは誤判定しない');
assert.equal(isMilestone({}), false);
assert.equal(isMilestone(null), false);

// ── タグのトグル（本文を書き換える＝データの持ち方は1本）──
assert.equal(toggleMsContent('運用開始'), '運用開始 #' + MS_TAG, '付ける');
assert.equal(toggleMsContent('運用開始 #マイルストーン'), '運用開始', '外す');
assert.equal(toggleMsContent('#マイルストーン 運用開始'), '運用開始', '先頭にあっても外す');
assert.equal(toggleMsContent('A #マイルストーン B #HACCP'), 'A B #HACCP', '他のタグは残す');
assert.equal(toggleMsContent('A #マイルストーン2'), 'A #マイルストーン2 #' + MS_TAG,
  '別タグは外さずに付ける');
assert.equal(toggleMsContent(''), '#' + MS_TAG, '空でも付けられる');
assert.equal(toggleMsContent(toggleMsContent('運用開始')), '運用開始', '2回で元に戻る');

console.log('PASS week.cardweek');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && node tests/week.cardweek.test.mjs`
Expected: FAIL — `cardWeekOf is not a function`（export されていない）

- [ ] **Step 3: Write minimal implementation**

Append to `v2/src/week.js`:

```js
// ── カードの所属週 ──
// 優先順位: ref.gridWk（明示上書き）> body.due（期限の週）> 出所日（day祖先）の週 > createdAt の週
export function cardWeekOf(body, ref, dayDate){
  if (ref && ref.gridWk) return ref.gridWk;
  if (body && body.due) return weekStart(body.due);
  if (dayDate) return weekStart(dayDate);
  if (body && body.createdAt) return weekStart(body.createdAt);
  return null;
}

// ── マイルストーン（本文の #マイルストーン タグ）──
export function isMilestone(body){
  return cardTags(body && body.content).has(MS_TAG);
}
// #マイルストーン を付け外しした本文を返す（他のタグ・別名タグには触らない）
export function toggleMsContent(content){
  const t = String(content || '');
  if (!cardTags(t).has(MS_TAG)) return (t + ' #' + MS_TAG).trim();
  let out = '', last = 0, m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(t))){
    if (m[1] !== MS_TAG) continue;              // 別タグ（#マイルストーン2 等）はそのまま残す
    out += t.slice(last, m.index);
    last = m.index + m[0].length;
  }
  out += t.slice(last);
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && node tests/week.cardweek.test.mjs`
Expected: `PASS week.cardweek`

- [ ] **Step 5: Run the whole suite**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f" || exit 1; done`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add v2/src/week.js v2/tests/week.cardweek.test.mjs
git commit -m "feat(v2): カードの所属週判定とマイルストーンタグのトグル"
```

---

## Task 3: PJ×週の集約（`buildWeeklyGrid`）

**Files:**
- Modify: `v2/src/week.js`（末尾に追記）
- Test: `v2/tests/week.grid.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `v2/tests/week.grid.test.mjs`:

```js
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
s.createCard({ kind:'memo', content:'全体状況', parentRefId: page.ref.id });
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

// PJページ内のカード → セルには入らない（PJ列に出ているため）
s.createCard({ kind:'task', content:'ページ内タスク', parentRefId: page.ref.id, proj: P.id });

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
const far = s.createCard({ kind:'task', content:'ずっと先', due:'2027-01-05',
                           parentRefId: d1.ref.id, proj: P.id });
const g4 = buildWeeklyGrid(s, { weeks: WEEKS, today: TODAY });
const allP4 = WEEKS.flatMap(w => g4.rows[0].cells[w].todo.map(e => e.body.content));
assert.equal(allP4.includes('ずっと先'), false, '表示範囲外の週のカードは出ない');

console.log('PASS week.grid');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && node tests/week.grid.test.mjs`
Expected: FAIL — `buildWeeklyGrid is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `v2/src/week.js`:

```js
// ── 集約 ──
// 祖先walkのメモ化索引。描画ごとに全カードを走査するため O(N) を維持する
// （project.js の collectMirrorRoots を全PJ1パスに一般化したもの）。
function makeAncIndex(store){
  const topMemo = new Map();     // refId -> { rootRefId, dayDate }
  const projMemo = new Map();    // refId -> Set（祖先の proj 値）
  function topInfo(refId){
    if (topMemo.has(refId)) return topMemo.get(refId);
    const r = store.getRef(refId);
    let out;
    if (!r) out = { rootRefId: null, dayDate: null };
    else if (!r.parentRefId){
      const b = store.getBody(r.bodyId);
      out = { rootRefId: r.id, dayDate: (b && b.kind === 'day') ? b.content : null };
    } else out = topInfo(r.parentRefId);
    topMemo.set(refId, out);
    return out;
  }
  function ancProjs(refId){
    if (projMemo.has(refId)) return projMemo.get(refId);
    const r = store.getRef(refId);
    let out;
    if (!r || !r.parentRefId) out = new Set();
    else {
      const pr = store.getRef(r.parentRefId);
      const pb = pr && store.getBody(pr.bodyId);
      out = new Set(ancProjs(r.parentRefId));
      if (pb && pb.proj) out.add(pb.proj);
    }
    projMemo.set(refId, out);
    return out;
  }
  return { topInfo, ancProjs };
}

const _cmp = (a, b) => { a = a || ''; b = b || ''; return a < b ? -1 : a > b ? 1 : 0; };
const _dueCmp = (a, b) => {
  const x = a.body.due, y = b.body.due;
  if (!x && !y) return 0;
  if (!x) return 1;                      // 期限なしは後ろ
  if (!y) return -1;
  return _cmp(x, y);
};
const CMP = {
  ms:   (a, b) => _cmp(a.body.due || a.day, b.body.due || b.day) || _cmp(a.body.content, b.body.content),
  todo: (a, b) => (b.body.prio || 0) - (a.body.prio || 0) || _dueCmp(a, b) || _cmp(a.day, b.day) || _cmp(a.body.content, b.body.content),
  done: (a, b) => _cmp(a.body.doneAt, b.body.doneAt) || _cmp(a.body.content, b.body.content),
  memo: (a, b) => _cmp(a.day, b.day) || _cmp(a.body.content, b.body.content),
  over: (a, b) => _cmp(a.wk, b.wk) || (b.body.prio || 0) - (a.body.prio || 0) || _cmp(a.body.content, b.body.content),
};
const LINK_NODE = 'リンク';                // この名前の直下ノードの「子」がリンク列になる

// PJ×週のグリッドデータを作る（DOM非依存）。weeks は weeksFor() の結果。
export function buildWeeklyGrid(store, { weeks, today, hideEmpty = false } = {}){
  const wkSet = new Set(weeks);
  const curWk = weekStart(today);
  const projs = store.listProjects();
  const mkCells = () => {
    const c = {};
    for (const w of weeks) c[w] = { ms:[], todo:[], done:[], memo:[], over:[] };
    return c;
  };
  const pageRoots = new Map();             // PJページのルート refId -> projId
  const rowByProj = new Map();
  for (const p of projs){
    const row = { projId: p.id, proj: p, kids: [], links: [], cells: mkCells(), total: 0 };
    rowByProj.set(p.id, row);
    const root = store.refsForBody(p.id).find(r => r.parentRefId === null);
    if (!root) continue;
    pageRoots.set(root.id, p.id);
    for (const c of store.childRefs(root.id)){        // PJ直下ノード／リンク列
      const b = store.getBody(c.bodyId);
      if (!b) continue;
      if ((b.content || '').trim() === LINK_NODE){
        for (const gr of store.childRefs(c.id)){
          const gb = store.getBody(gr.bodyId);
          if (gb) row.links.push({ ref: gr, body: gb });
        }
      } else row.kids.push({ ref: c, body: b });
    }
  }
  const unassigned = { projId: null, proj: null, kids: [], links: [], cells: mkCells(), total: 0 };
  const { topInfo, ancProjs } = makeAncIndex(store);

  for (const b of store.queryBodies(x => x.kind !== 'project' && x.kind !== 'day')){
    const ref = store.refsForBody(b.id)[0];
    if (!ref) continue;
    const top = topInfo(ref.id);
    if (pageRoots.has(top.rootRefId)) continue;            // PJページ内は除外（PJ列に出ている）
    const ancs = ancProjs(ref.id);
    let row;
    if (b.proj){
      if (ancs.has(b.proj)) continue;                      // 同PJの祖先を持つ＝最上位だけ拾う
      row = rowByProj.get(b.proj);
      if (!row) continue;                                  // 消えたPJを指している
    } else {
      if (b.kind !== 'task' || b.done) continue;           // 未割当行は未完了タスクのみ
      let hasProjAnc = false;
      for (const v of ancs) if (v){ hasProjAnc = true; break; }
      if (hasProjAnc) continue;                            // 割当済みタスクのサブタスクは拾わない
      row = unassigned;
    }
    const wk = cardWeekOf(b, ref, top.dayDate);
    const e = { ref, body: b, day: top.dayDate, wk };
    if (isMilestone(b)){                                   // マイルストーンは所属週の先頭・繰越しない
      if (wkSet.has(wk)){ row.cells[wk].ms.push(e); row.total++; }
    } else if (b.kind === 'task' && b.done){
      const dw = b.doneAt ? weekStart(b.doneAt) : wk;       // やったこと＝完了週
      if (wkSet.has(dw)){ row.cells[dw].done.push(e); row.total++; }
    } else if (b.kind === 'task'){
      if (wkSet.has(wk)){ row.cells[wk].todo.push(e); row.total++; }
      for (const w of weeks){                              // 繰越: 所属週 < w ≤ 今週
        if (wk && w > wk && w <= curWk){ row.cells[w].over.push(e); row.total++; }
      }
    } else {
      if (wkSet.has(wk)){ row.cells[wk].memo.push(e); row.total++; }
    }
  }
  const rows = [];
  for (const p of projs){
    const row = rowByProj.get(p.id);
    for (const w of weeks) for (const k of ['ms','todo','done','memo','over']) row.cells[w][k].sort(CMP[k]);
    if (!hideEmpty || row.total > 0) rows.push(row);
  }
  if (unassigned.total){
    for (const w of weeks) unassigned.cells[w].todo.sort(CMP.todo);
    rows.push(unassigned);
  }
  return { weeks: weeks.map(w => ({ wk: w, label: weekLabel(w), isCurrent: w === curWk })), rows };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && node tests/week.grid.test.mjs`
Expected: `PASS week.grid`

- [ ] **Step 5: Run the whole suite**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f" || exit 1; done`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add v2/src/week.js v2/tests/week.grid.test.mjs
git commit -m "feat(v2): PJ×週の集約 buildWeeklyGrid（5ブロック分類・PJ列/リンク列・未割当行）"
```

---

## Task 4: 期限切れ繰越のテスト（実装は Task 3 に含む）

Task 3 の実装で繰越も入れてあるので、ここは**仕様を固定するテストだけ**を書く。

**Files:**
- Test: `v2/tests/week.over.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `v2/tests/week.over.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `cd v2 && node tests/week.over.test.mjs`
Expected: `PASS week.over`（Task 3 の実装で通るはず）。
落ちた場合は Task 3 の繰越ループ（`if (wk && w > wk && w <= curWk)`）と
「元の週の todo にも残す」処理を見直す。テストが正しく実装を直す。

- [ ] **Step 3: Run the whole suite**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f" || exit 1; done`
Expected: 全 PASS

- [ ] **Step 4: Commit**

```bash
git add v2/tests/week.over.test.mjs
git commit -m "test(v2): 期限切れ繰越の仕様を固定（完了まで毎週・MS/メモは対象外・未来週には出さない）"
```

---

## Task 5: カーソル移動（`moveCursor`）

**Files:**
- Modify: `v2/src/week.js`（末尾に追記）
- Test: `v2/tests/week.cursor.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `v2/tests/week.cursor.test.mjs`:

```js
import assert from 'node:assert/strict';
import { moveCursor, FIRST_WEEK_COL } from '../src/week.js';

// 2行 × 4列（proj, link, 週A, 週B）。counts はスロット数（空セルも1）
const shape = {
  rows: ['p1', 'p2'],
  cols: ['proj', 'link', 'wA', 'wB'],
  counts: new Map([
    ['p1|proj', 3], ['p1|link', 2], ['p1|wA', 3], ['p1|wB', 1],
    ['p2|proj', 1], ['p2|link', 1], ['p2|wA', 2], ['p2|wB', 1],
  ]),
};
const at = (row, colIdx, idx) => ({ row, colIdx, idx });
const mv = (c, key) => moveCursor(shape, c, key);

assert.equal(FIRST_WEEK_COL, 2, 'cols[0]=proj / cols[1]=link なので最初の週列は index 2');

// ── ↓: セル内を進み、最下段で次のPJの同じ列の先頭へ ──
assert.deepEqual(mv(at('p1', 2, 0), 'ArrowDown').cursor, at('p1', 2, 1), 'セル内で下へ');
assert.deepEqual(mv(at('p1', 2, 2), 'ArrowDown').cursor, at('p2', 2, 0), '最下段→次PJのセル先頭');
assert.deepEqual(mv(at('p2', 2, 1), 'ArrowDown').cursor, at('p2', 2, 1), '最終行では動かない');
assert.equal(mv(at('p1', 2, 2), 'ArrowDown').page, 0, '縦移動で週送りはしない');

// ── ↑: 最上段で前のPJの同じ列の末尾へ ──
assert.deepEqual(mv(at('p1', 2, 1), 'ArrowUp').cursor, at('p1', 2, 0));
assert.deepEqual(mv(at('p2', 2, 0), 'ArrowUp').cursor, at('p1', 2, 2), '最上段→前PJのセル末尾');
assert.deepEqual(mv(at('p1', 0, 0), 'ArrowUp').cursor, at('p1', 0, 0), '先頭行では動かない');

// ── →/←: 行内で列移動。縦位置は保つ（無ければ末尾にクランプ）──
assert.deepEqual(mv(at('p1', 0, 0), 'ArrowRight').cursor, at('p1', 1, 0));
assert.deepEqual(mv(at('p1', 2, 2), 'ArrowRight').cursor, at('p1', 3, 0),
  '移動先のスロットが1つなら末尾(=0)にクランプ');
assert.deepEqual(mv(at('p1', 1, 1), 'ArrowLeft').cursor, at('p1', 0, 1), '縦位置を保つ');
assert.deepEqual(mv(at('p1', 2, 0), 'ArrowLeft').cursor, at('p1', 1, 0));

// ── 端で週送り（左右対称：新しく現れた週列にフォーカス）──
const right = mv(at('p1', 3, 0), 'ArrowRight');
assert.equal(right.page, 1, '右端でさらに→ は週送り(進む)');
assert.deepEqual(right.cursor, at('p1', 3, 0), '右端の列に留まる＝新しく現れた週');
const left = mv(at('p1', 0, 1), 'ArrowLeft');
assert.equal(left.page, -1, '左端でさらに← は週送り(戻る)');
assert.deepEqual(left.cursor, at('p1', FIRST_WEEK_COL, 0), '新しく現れた最初の週列へ');

// ── Tab / Shift+Tab: セル単位 ──
assert.deepEqual(mv(at('p1', 2, 2), 'Tab').cursor, at('p1', 3, 0), '次のセルの先頭');
assert.deepEqual(mv(at('p1', 3, 0), 'Tab').cursor, at('p2', 0, 0), '行末→次PJの先頭列');
assert.deepEqual(mv(at('p2', 3, 0), 'Tab').cursor, at('p2', 3, 0), '最終セルでは動かない');
assert.deepEqual(mv(at('p2', 0, 0), 'ShiftTab').cursor, at('p1', 3, 0), '行頭→前PJの末尾列');
assert.deepEqual(mv(at('p1', 2, 1), 'ShiftTab').cursor, at('p1', 1, 0));

// ── Home / End ──
assert.deepEqual(mv(at('p1', 2, 1), 'Home').cursor, at('p1', 0, 0));
assert.deepEqual(mv(at('p1', 0, 0), 'End').cursor, at('p1', 3, 0));

// ── 未知キーは動かない ──
assert.deepEqual(mv(at('p1', 1, 1), 'KeyX').cursor, at('p1', 1, 1));

// ── 消えた行/列・範囲外の idx は近傍にクランプ（再描画で行が減った場合）──
assert.deepEqual(mv(at('missing', 2, 0), 'ArrowDown').cursor, at('p1', 2, 1),
  '消えた行は先頭行として扱う');
assert.deepEqual(mv(at('p1', 99, 0), 'ArrowUp').cursor, at('p1', 3, 0), '範囲外の列をクランプ');
assert.deepEqual(mv(at('p1', 2, 99), 'ArrowUp').cursor, at('p1', 2, 1), '範囲外の idx をクランプ');

// ── counts に無い (row,col) は空セル＝スロット1 として扱う ──
const bare = { rows:['r1'], cols:['proj','link','wA'], counts: new Map() };
assert.deepEqual(moveCursor(bare, at('r1', 0, 0), 'ArrowDown').cursor, at('r1', 0, 0));
assert.deepEqual(moveCursor(bare, at('r1', 0, 0), 'ArrowRight').cursor, at('r1', 1, 0));

console.log('PASS week.cursor');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && node tests/week.cursor.test.mjs`
Expected: FAIL — `moveCursor is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `v2/src/week.js`:

```js
// ── カーソル移動（グリッドのキー操作）──
// shape = { rows:[rowId…], cols:[colId…], counts: Map(`rowId|colId` → スロット数) }
//   cols は ['proj','link', …週キー]。空セルもスロット1（セル自体にフォーカス）＝どの (row,col) も1以上。
// cursor = { row, colIdx, idx }（列は添字で持つ＝週送りで週キーが変わっても端に留まれる）
// 戻り値 = { cursor, page }（page: -1|0|+1 の週送り要求。呼び出し側が weeks を作り直す）
export const FIRST_WEEK_COL = 2;

export function slotCount(shape, rowId, colId){
  const n = shape.counts.get(rowId + '|' + colId);
  return n && n > 0 ? n : 1;
}
export function moveCursor(shape, cursor, key){
  const rows = shape.rows, cols = shape.cols;
  if (!rows.length || !cols.length) return { cursor, page: 0 };
  let ri = rows.indexOf(cursor.row); if (ri < 0) ri = 0;
  const ci0 = Math.min(Math.max(cursor.colIdx | 0, 0), cols.length - 1);
  const count = (r, c) => slotCount(shape, rows[r], cols[c]);
  const put = (r, c, i) => ({ row: rows[r], colIdx: c, idx: Math.min(Math.max(i, 0), count(r, c) - 1) });
  const stay = { cursor: put(ri, ci0, cursor.idx | 0), page: 0 };
  const idx = stay.cursor.idx;              // クランプ済みの縦位置

  switch (key){
    case 'ArrowDown':
      if (idx + 1 < count(ri, ci0))  return { cursor: put(ri, ci0, idx + 1), page: 0 };
      if (ri + 1 < rows.length)      return { cursor: put(ri + 1, ci0, 0), page: 0 };
      return stay;
    case 'ArrowUp':
      if (idx > 0)                   return { cursor: put(ri, ci0, idx - 1), page: 0 };
      if (ri > 0)                    return { cursor: put(ri - 1, ci0, count(ri - 1, ci0) - 1), page: 0 };
      return stay;
    case 'ArrowRight':
      if (ci0 + 1 < cols.length)     return { cursor: put(ri, ci0 + 1, idx), page: 0 };
      return { cursor: { row: rows[ri], colIdx: cols.length - 1, idx: 0 }, page: 1 };
    case 'ArrowLeft':
      if (ci0 > 0)                   return { cursor: put(ri, ci0 - 1, idx), page: 0 };
      return { cursor: { row: rows[ri], colIdx: Math.min(FIRST_WEEK_COL, cols.length - 1), idx: 0 }, page: -1 };
    case 'Tab':
      if (ci0 + 1 < cols.length)     return { cursor: put(ri, ci0 + 1, 0), page: 0 };
      if (ri + 1 < rows.length)      return { cursor: put(ri + 1, 0, 0), page: 0 };
      return stay;
    case 'ShiftTab':
      if (ci0 > 0)                   return { cursor: put(ri, ci0 - 1, 0), page: 0 };
      if (ri > 0)                    return { cursor: put(ri - 1, cols.length - 1, 0), page: 0 };
      return stay;
    case 'Home': return { cursor: put(ri, 0, 0), page: 0 };
    case 'End':  return { cursor: put(ri, cols.length - 1, 0), page: 0 };
    default:     return stay;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && node tests/week.cursor.test.mjs`
Expected: `PASS week.cursor`

- [ ] **Step 5: Run the whole suite**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f" || exit 1; done`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add v2/src/week.js v2/tests/week.cursor.test.mjs
git commit -m "feat(v2): グリッドのカーソル移動 moveCursor（縦連続・行またぎ・端で週送り）"
```

---

## Task 6: 週報テキストの生成

**Files:**
- Modify: `v2/src/week.js`（末尾に追記）
- Test: `v2/tests/week.report.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `v2/tests/week.report.test.mjs`:

```js
import assert from 'node:assert/strict';
import { buildWeekReport } from '../src/week.js';

// buildWeeklyGrid の結果の形を最小限で作る（描画に依存しない純関数のテスト）
const e = (content, extra = {}) => ({ ref:{ id:'r' }, body:{ content, ...extra }, day:'2026-07-22', wk:'2026-07-20' });
const cell = (o = {}) => ({ ms:[], todo:[], done:[], memo:[], over:[], ...o });
const grid = {
  weeks: [{ wk:'2026-07-20', label:'7/20〜7/26', isCurrent:true }],
  rows: [
    { projId:'p1', proj:{ content:'PJ.HACCP' }, kids:[], links:[], total:4, cells:{
      '2026-07-20': cell({
        ms:   [e('運用開始 #マイルストーン')],
        done: [e('SP外部社と打合せ')],
        todo: [e('標準温度の確認')],
        memo: [e('議事録: キックオフ')],
        over: [{ ...e('見積依頼'), wk:'2026-07-13' }],
      }),
    }},
    { projId:'p2', proj:{ content:'PJ.Empty' }, kids:[], links:[], total:0, cells:{ '2026-07-20': cell() }},
    { projId:null, proj:null, kids:[], links:[], total:1, cells:{
      '2026-07-20': cell({ todo:[e('割当漏れ')] }) }},
  ],
};

const r = buildWeekReport(grid, '2026-07-20');

// プレーンテキスト
assert.match(r.plain, /^週次レポート 7\/20〜7\/26\n/, '先頭は週ラベル');
assert.match(r.plain, /■ PJ\.HACCP/);
assert.match(r.plain, /【マイルストーン】\n\s+🏁 運用開始/, 'タグは表示から除く');
assert.match(r.plain, /【やったこと】\n\s+・SP外部社と打合せ/);
assert.match(r.plain, /【やること】\n\s+・標準温度の確認/);
assert.match(r.plain, /【メモ】\n\s+・議事録: キックオフ/);
assert.match(r.plain, /【期限切れ】\n\s+・見積依頼（7\/13週）/, '期限切れは元の週を添える');
assert.match(r.plain, /■ 未割当/, '未割当行も出す');
assert.equal(r.plain.includes('PJ.Empty'), false, '中身の無いPJは出さない');

// ブロック順は マイルストーン → やったこと → やること → メモ → 期限切れ
const order = ['【マイルストーン】', '【やったこと】', '【やること】', '【メモ】', '【期限切れ】']
  .map(k => r.plain.indexOf(k));
assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'ブロックの順序が固定されている');

// HTML（メール/OneNote貼付用）
assert.match(r.html, /<h3>PJ\.HACCP<\/h3>/);
assert.match(r.html, /<li>標準温度の確認<\/li>/);
assert.equal(r.html.includes('<script'), false);

// HTMLエスケープ（本文に < > & が入っても壊れない）
const g2 = { weeks:[{ wk:'2026-07-20', label:'7/20〜7/26', isCurrent:true }],
  rows:[{ projId:'p1', proj:{ content:'A & B' }, kids:[], links:[], total:1,
    cells:{ '2026-07-20': cell({ todo:[e('<b>危険</b>')] }) } }] };
const r2 = buildWeekReport(g2, '2026-07-20');
assert.match(r2.html, /A &amp; B/);
assert.match(r2.html, /&lt;b&gt;危険&lt;\/b&gt;/);
assert.match(r2.plain, /・<b>危険<\/b>/, 'プレーンはそのまま');

// 該当週が無ければ空文字（クラッシュしない）
const r3 = buildWeekReport(grid, '2099-01-04');
assert.equal(r3.plain, '');
assert.equal(r3.html, '');

console.log('PASS week.report');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && node tests/week.report.test.mjs`
Expected: FAIL — `buildWeekReport is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `v2/src/week.js`:

```js
// ── 週報の組み立て（1週ぶんを HTML＋プレーンテキストに）──
// 表示用テキストは #マイルストーン タグを落とす（読み物として不要なため）。
const _escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const _label = (s) => String(s || '').replace(new RegExp('\\s*#' + MS_TAG + '(?=\\s|$)', 'g'), '').trim();
const REPORT_BLOCKS = [
  ['ms',   'マイルストーン', '🏁 '],
  ['done', 'やったこと',    '・'],
  ['todo', 'やること',      '・'],
  ['memo', 'メモ',          '・'],
  ['over', '期限切れ',      '・'],
];

export function buildWeekReport(grid, wk){
  const head = (grid.weeks || []).find(w => w.wk === wk);
  if (!head) return { plain: '', html: '' };
  let plain = '週次レポート ' + head.label + '\n', html = '<h2>週次レポート ' + _escHtml(head.label) + '</h2>';
  for (const row of grid.rows || []){
    const cell = row.cells && row.cells[wk];
    if (!cell) continue;
    const blocks = REPORT_BLOCKS.filter(([k]) => (cell[k] || []).length);
    if (!blocks.length) continue;
    const name = row.proj ? (row.proj.content || '(無題)') : '未割当';
    plain += '\n■ ' + name + '\n';
    html += '<h3>' + _escHtml(name) + '</h3>';
    for (const [k, title, bullet] of blocks){
      plain += '  【' + title + '】\n';
      html += '<p><b>' + _escHtml(title) + '</b></p><ul>';
      for (const e of cell[k]){
        const t = _label(e.body.content) || '(空)';
        const note = (k === 'over' && e.wk && e.wk !== wk) ? '（' + weekLabel(e.wk).split('〜')[0] + '週）' : '';
        plain += '    ' + bullet + t + note + '\n';
        html += '<li>' + _escHtml(t + note) + '</li>';
      }
      html += '</ul>';
    }
  }
  return { plain, html };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && node tests/week.report.test.mjs`
Expected: `PASS week.report`

- [ ] **Step 5: Run the whole suite**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f" || exit 1; done`
Expected: 全 PASS（週次の純ロジック6本＋既存33本）

- [ ] **Step 6: Commit**

```bash
git add v2/src/week.js v2/tests/week.report.test.mjs
git commit -m "feat(v2): 週報テキスト/HTMLの生成 buildWeekReport"
```

---

## Task 7: ビューの登録と表の骨格（読み取り専用で表示できる状態にする）

ここから DOM。まず**見えるようにする**ことを優先し、キー操作と編集は次タスク。

**Files:**
- Create: `v2/src/weekly.js`
- Modify: `v2/index.html:11-25`（ツールバー）、`v2/index.html:26-32`（ビュー枠）
- Modify: `v2/src/app.js`
- Modify: `v2/style.css`（末尾に追記）

- [ ] **Step 1: `index.html` にボタンとビュー枠を追加**

`v2/index.html` の `view-search-btn` の直後に週次ボタンを追加:

```html
  <button class="btn" id="view-search-btn">🔍 検索</button>
  <button class="btn" id="view-weekly-btn" title="週次ビュー（Alt+4）">▦ 週次</button>
```

`#app` の中、`#view-search` の直後にビュー枠を追加:

```html
    <div id="view-search" hidden></div>
    <div id="view-weekly" hidden></div>
```

- [ ] **Step 2: `weekly.js` の骨格（表の描画のみ）を作る**

Create `v2/src/weekly.js`:

```js
// 週次ビュー: 縦=プロジェクト / 横=週 のマトリクス。
// データの正はデイリー/PJページのカードのままで、ここは「振り分けて見せる」だけ（派生ビュー）。
// 純ロジック（週キー・集約・カーソル移動・週報）は week.js。ここは描画とイベントに専念する。
const _q = new URL(import.meta.url).search;
const { buildWeeklyGrid, weeksFor, weekLabel, weekAdd, weekStart, moveCursor,
        toggleMsContent, buildWeekReport, FIRST_WEEK_COL } = await import('./week.js' + _q);
const { renderChildren, setNavContainer, focusCard, getHideDone } = await import('./daily.js' + _q);
const { showToast, copyRichText } = await import('./clipboard.js' + _q);

const todayStr = () => new Date().toISOString().slice(0, 10);

// 外から差し込む遷移（app.js が設定）
let _onOpenProject = null;        // (projId) => void
let _onOpenProjectAt = null;      // (projId, refId) => void  直下ノードへズームして開く
let _onJump = null;               // (bodyId) => void         元の場所（デイリー）へ
export function setWeeklyHandlers({ openProject, openProjectAt, jump }){
  _onOpenProject = openProject || null;
  _onOpenProjectAt = openProjectAt || null;
  _onJump = jump || null;
}

// ブロックの定義（表示順）。kind は ＋追加で作るカードの種類
const BLOCKS = [
  { key:'ms',   label:'🏁 マイルストーン', cls:'wk-b-ms' },
  { key:'todo', label:'□ やること',        cls:'wk-b-todo', add:{ kind:'task' } },
  { key:'done', label:'✓ やったこと',      cls:'wk-b-done', add:{ kind:'task', done:true } },
  { key:'memo', label:'📝 メモ',           cls:'wk-b-memo', add:{ kind:'memo' } },
  { key:'over', label:'↩ 期限切れ',        cls:'wk-b-over', ref:true },   // ref:true = 参照行（編集不可）
];

export function renderWeeklyView(store, mount, requestRender, state){
  const today = todayStr();
  const weeks = weeksFor(today, state.wkOff || 0);
  const grid = buildWeeklyGrid(store, { weeks, today, hideEmpty: !!state.hideEmpty });

  mount.innerHTML = '';
  mount.appendChild(buildBar(store, requestRender, state, grid, weeks, today));

  const scroll = document.createElement('div'); scroll.className = 'wk-scroll';
  const table = document.createElement('table'); table.className = 'wk-table';
  table.appendChild(buildHead(grid));
  const tbody = document.createElement('tbody');
  for (const row of grid.rows) tbody.appendChild(buildRow(store, requestRender, state, row, grid));
  table.appendChild(tbody);
  scroll.appendChild(table);
  mount.appendChild(scroll);

  if (!grid.rows.length){
    const e = document.createElement('p'); e.className = 'wk-empty';
    e.textContent = state.hideEmpty
      ? '表示範囲に内容のあるプロジェクトがありません（「空PJを表示」で全件表示）。'
      : 'プロジェクトがありません。ツールバーの「＋ プロジェクト」で作成してください。';
    mount.appendChild(e);
  }
}

// ── ビューバー（週送り／今週／空PJ／週報コピー）──
function buildBar(store, requestRender, state, grid, weeks, today){
  const bar = document.createElement('div'); bar.className = 'wk-bar';
  const mkBtn = (label, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn wk-btn'; b.textContent = label; b.title = title;
    b.onclick = fn; bar.appendChild(b); return b;
  };
  mkBtn('◀ 前週', '前の週へ（Alt+Shift+←）', () => pageWeeks(state, requestRender, -1));
  mkBtn('今週', '今週へ（Alt+0）', () => { state.wkOff = 0; savePrefs(state); requestRender(); });
  mkBtn('次週 ▶', '次の週へ（Alt+Shift+→）', () => pageWeeks(state, requestRender, 1));

  const range = document.createElement('span'); range.className = 'wk-range';
  range.textContent = weekLabel(weeks[0]) + ' 〜 ' + weekLabel(weeks[weeks.length - 1]);
  bar.appendChild(range);

  const sp = document.createElement('span'); sp.className = 'spacer'; bar.appendChild(sp);

  const chk = document.createElement('label'); chk.className = 'wk-chk';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !state.hideEmpty;
  cb.onchange = () => { state.hideEmpty = !cb.checked; savePrefs(state); requestRender(); };
  chk.appendChild(cb); chk.appendChild(document.createTextNode(' 空PJを表示'));
  bar.appendChild(chk);

  mkBtn('📋 週報コピー', 'この週のまとめをコピー（HTML＋テキスト）', () => {
    const cur = weekStart(today);
    const wk = weeks.includes(cur) ? cur : weeks[0];
    const r = buildWeekReport(grid, wk);
    if (!r.plain){ showToast('この週には内容がありません'); return; }
    copyRichText(r.html, r.plain).then(ok => showToast(ok ? '週報をコピーしました' : 'コピーに失敗しました'));
  });
  return bar;
}
export function pageWeeks(state, requestRender, d){
  state.wkOff = (state.wkOff || 0) + d;
  savePrefs(state);
  requestRender();
}
function savePrefs(state){
  try {
    localStorage.setItem('pwt2_wkOff', String(state.wkOff || 0));
    localStorage.setItem('pwt2_wkHideEmpty', state.hideEmpty ? '1' : '0');
  } catch {}
}
export function loadWeeklyPrefs(){
  const st = { wkOff: 0, hideEmpty: false, expanded: null };
  try {
    const o = parseInt(localStorage.getItem('pwt2_wkOff'), 10);
    if (Number.isFinite(o)) st.wkOff = o;
    st.hideEmpty = localStorage.getItem('pwt2_wkHideEmpty') === '1';
  } catch {}
  return st;
}

// ── ヘッダ行 ──
function buildHead(grid){
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  const th1 = document.createElement('th'); th1.className = 'wk-th wk-c-proj'; th1.textContent = 'プロジェクト';
  const th2 = document.createElement('th'); th2.className = 'wk-th wk-c-link'; th2.textContent = 'リンク';
  tr.appendChild(th1); tr.appendChild(th2);
  for (const w of grid.weeks){
    const th = document.createElement('th');
    th.className = 'wk-th wk-c-week' + (w.isCurrent ? ' wk-current' : '');
    const l = document.createElement('div'); l.className = 'wk-th-label'; l.textContent = w.label;
    th.appendChild(l);
    if (w.isCurrent){ const n = document.createElement('div'); n.className = 'wk-th-now'; n.textContent = '今週'; th.appendChild(n); }
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  return thead;
}

// ── 1プロジェクト行 ──
function buildRow(store, requestRender, state, row, grid){
  const tr = document.createElement('tr');
  tr.className = 'wk-row' + (row.projId ? '' : ' wk-row-none');
  tr.dataset.row = row.projId || '__none';
  tr.appendChild(buildProjCell(store, requestRender, row));
  tr.appendChild(buildLinkCell(row));
  for (const w of grid.weeks) tr.appendChild(buildWeekCell(store, requestRender, state, row, w));
  return tr;
}

function buildProjCell(store, requestRender, row){
  const td = document.createElement('td'); td.className = 'wk-cell wk-c-proj';
  td.dataset.col = 'proj';
  const title = document.createElement('div');
  title.className = 'wk-item wk-proj-title'; title.tabIndex = -1;
  title.dataset.act = row.projId ? 'proj' : 'none';
  title.textContent = row.proj ? ('📕 ' + (row.proj.content || '(無題)')) : '未割当';
  if (row.projId){
    title.title = 'Enter / クリックでプロジェクトを開く';
    title.onclick = () => _onOpenProject && _onOpenProject(row.projId);
  }
  td.appendChild(title);
  if (row.projId){
    const mv = document.createElement('span'); mv.className = 'wk-proj-move';
    for (const [label, dir, tip] of [['▲', -1, '上へ'], ['▼', 1, '下へ']]){
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'wk-mv'; b.textContent = label; b.title = tip + '（プロジェクト一覧の並び順）';
      b.onclick = (e) => { e.stopPropagation(); if (store.moveProject(row.projId, dir)) requestRender(); };
      mv.appendChild(b);
    }
    title.appendChild(mv);
  }
  for (const k of row.kids){
    const it = document.createElement('div');
    it.className = 'wk-item wk-proj-kid'; it.tabIndex = -1;
    it.dataset.act = 'kid'; it.dataset.kidRef = k.ref.id; it.dataset.proj = row.projId;
    it.textContent = k.body.content || '(空)';
    it.title = 'Enter / クリックでこのノードを開く';
    it.onclick = () => _onOpenProjectAt && _onOpenProjectAt(row.projId, k.ref.id);
    td.appendChild(it);
  }
  return td;
}

function buildLinkCell(row){
  const td = document.createElement('td'); td.className = 'wk-cell wk-c-link';
  td.dataset.col = 'link';
  if (!row.links.length){
    const ph = document.createElement('div');
    ph.className = 'wk-item wk-ph'; ph.tabIndex = -1; ph.dataset.act = 'none';
    td.appendChild(ph);
    return td;
  }
  for (const l of row.links){
    const it = document.createElement('div');
    it.className = 'wk-item wk-link'; it.tabIndex = -1;
    it.dataset.act = 'link'; it.dataset.url = l.body.url || ''; it.dataset.kidRef = l.ref.id;
    it.dataset.proj = row.projId || '';
    it.textContent = '- ' + (l.body.content || '(空)');
    it.title = l.body.url || 'Enter / クリックでこのノードを開く';
    it.onclick = () => openLink(it);
    td.appendChild(it);
  }
  return td;
}
export function openLink(el){
  const url = el.dataset.url;
  if (url) window.open(url, '_blank', 'noopener');
  else if (_onOpenProjectAt && el.dataset.proj) _onOpenProjectAt(el.dataset.proj, el.dataset.kidRef);
}

// ── 週セル（コンパクト表示）──
function buildWeekCell(store, requestRender, state, row, w){
  const td = document.createElement('td');
  td.className = 'wk-cell wk-c-week' + (w.isCurrent ? ' wk-current' : '');
  td.dataset.col = w.wk; td.dataset.row = row.projId || '__none';
  const cell = row.cells[w.wk];
  const hideDone = getHideDone();
  let n = 0;
  for (const B of BLOCKS){
    let items = cell[B.key] || [];
    // 完了非表示（Alt+H）は「やったこと」には適用しない（完了専用ブロックなので常に空になる）
    if (hideDone && B.key !== 'done') items = items.filter(e => !e.body.done);
    if (!items.length) continue;
    const bl = document.createElement('div'); bl.className = 'wk-block ' + B.cls;
    const h = document.createElement('div'); h.className = 'wk-block-h'; h.textContent = B.label;
    bl.appendChild(h);
    for (const e of items){ bl.appendChild(buildItem(store, requestRender, e, B, row, w)); n++; }
    td.appendChild(bl);
  }
  if (!n){                                   // 空セルもスロット1（フォーカスできる）
    const ph = document.createElement('div');
    ph.className = 'wk-item wk-ph'; ph.tabIndex = -1; ph.dataset.act = 'add';
    ph.dataset.row = row.projId || '__none'; ph.dataset.wk = w.wk;
    ph.title = 'Enter / クリックでこの週にタスクを追加';
    td.appendChild(ph);
  }
  return td;
}

// 1件の行。over（繰越）は参照行＝data-ref を付けない（同一 refId が DOM に2つあると focusCard が誤爆する）
function buildItem(store, requestRender, e, B, row, w){
  const it = document.createElement('div');
  it.className = 'wk-item wk-i-' + B.key; it.tabIndex = -1;
  it.dataset.act = 'card'; it.dataset.body = e.body.id;
  it.dataset.row = row.projId || '__none'; it.dataset.wk = w.wk;
  if (B.ref) it.dataset.overRef = e.ref.id; else it.dataset.itemRef = e.ref.id;

  if (e.body.kind === 'task'){
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'wk-cb'; cb.checked = !!e.body.done;
    cb.onclick = (ev) => ev.stopPropagation();
    cb.onchange = () => { store.updateBody(e.body.id, { done: cb.checked }); requestRender(); };
    it.appendChild(cb);
  } else {
    const dot = document.createElement('span'); dot.className = 'wk-dot'; it.appendChild(dot);
  }
  const tx = document.createElement('span');
  tx.className = 'wk-tx' + (e.body.done ? ' done' : '');
  tx.textContent = e.body.content || '(空)';
  it.appendChild(tx);

  const kids = store.childRefs(e.ref.id).length;
  if (kids){ const b = document.createElement('span'); b.className = 'wk-badge'; b.textContent = String(kids); it.appendChild(b); }
  if (e.body.due){ const b = document.createElement('span'); b.className = 'wk-badge wk-due'; b.textContent = '📅' + e.body.due.slice(5); it.appendChild(b); }
  if (B.key === 'over'){ const b = document.createElement('span'); b.className = 'wk-badge wk-from'; b.textContent = weekLabel(e.wk).split('〜')[0] + '週'; it.appendChild(b); }
  return it;
}
```

- [ ] **Step 3: `clipboard.js` に `copyRichText` を追加**

`v2/src/clipboard.js` の `showToast` の定義の直前（`export function showToast` の行の上）に追加:

```js
// ボタン操作から HTML＋テキストをクリップボードへ（週報コピー用）。
// 非同期 API が使えない/拒否された環境では execCommand('copy') にフォールバックする。
export async function copyRichText(html, plain){
  try {
    if (navigator.clipboard && window.ClipboardItem){
      await navigator.clipboard.write([new ClipboardItem({
        'text/html':  new Blob([html],  { type:'text/html' }),
        'text/plain': new Blob([plain], { type:'text/plain' }),
      })]);
      return true;
    }
  } catch(_){}
  try {
    const ta = document.createElement('textarea');
    ta.value = plain; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch(_){ return false; }
}
```

- [ ] **Step 4: `app.js` に週次ビューを登録**

`v2/src/app.js:8` の `renderSearchView` の import の下に追加:

```js
const { renderWeeklyView, loadWeeklyPrefs, setWeeklyHandlers, pageWeeks, onWeeklyKey } = await import('./weekly.js' + _q);
```

`APP_VERSION` を `'0.95.0'` に変更（`v2/src/app.js:15`）。

`searchState` の定義（`v2/src/app.js:24`）の直後に状態を追加:

```js
const weeklyState = loadWeeklyPrefs();               // 週次ビュー: { wkOff, hideEmpty, expanded }
```

`localStorage` からのビュー復元（`v2/src/app.js:35`）の許可リストに `'weekly'` を追加:

```js
  const cv = localStorage.getItem('pwt2_view'); if (cv === 'daily' || cv === 'list' || cv === 'project' || cv === 'search' || cv === 'weekly') currentView = cv;
```

`showView`（`v2/src/app.js:47-50`）を差し替え（週次は幅を使うので分割を解除する）:

```js
function showView(v){
  if (v === 'weekly') splitOn = false;                                                   // 週次は全幅で使う（分割を解除）
  if (splitOn && (v === 'daily' || v === 'project' || v === 'search')) splitRight = v;   // 分割中はリスト以外＝右ペインの内容
  currentView = v;
}
```

`renderAll`（`v2/src/app.js:155-197`）の非分割ブロックに週次を追加。`const sv = ...` の下に:

```js
  const wv = document.getElementById('view-weekly');
```

分割時のブロック（`if (splitOn){` の中）の先頭に:

```js
    if (wv) wv.hidden = true;                        // 週次は分割に参加しない
```

`} else {` のブロックに追加（`sv.hidden` の行の後、`renderSearchView` の行の後）:

```js
    if (wv) wv.hidden = currentView !== 'weekly';
    if (currentView === 'weekly' && wv) renderWeeklyView(store, wv, renderAll, weeklyState);
```

ボタンのアクティブ表示（`view-search-btn` の行の後）:

```js
  document.getElementById('view-weekly-btn')?.classList.toggle('active', currentView === 'weekly');
```

`focusActiveViewFirst`（`v2/src/app.js:202`）の id 決定に週次を追加:

```js
  let id = currentView === 'list' ? 'view-list' : currentView === 'project' ? 'view-project' : currentView === 'search' ? 'view-search' : currentView === 'weekly' ? 'view-weekly' : 'view-daily';
```

同関数の本文セレクタ（`v2/src/app.js:206`）の先頭に `.wk-item` を追加:

```js
  const el = cont.querySelector('.wk-item, .list-table .title-chip, .list-table .nav-head, .card-txt, .day-head, .card-block, .zoom-title-txt, .proj-land-row, .search-kw, .card-add, .proj-land-add')
```

`focusin` のペイン記録（`v2/src/app.js:489`）に `#view-weekly` を追加:

```js
    const c = e.target.closest && e.target.closest('#view-list,#view-daily,#view-project,#view-search,#view-weekly');
```

`openProject` の直後に「PJのそのノードを開く」を追加:

```js
// PJページをそのノードにズームして開く（週次ビューの直下ノード/リンクのクリック先）
function openProjectAt(projId, refId){
  navPush();
  projState.projId = projId; projState.rootRef = refId || null;
  showView('project');
  renderAll();
}
```

`boot()` の中、`document.getElementById('view-search-btn')?...` の行の後に:

```js
  document.getElementById('view-weekly-btn')?.addEventListener('click', () => selectView('weekly'));
```

`boot()` の中、`setMentionJump(jumpToMention);` の行の後に:

```js
  setWeeklyHandlers({ openProject, openProjectAt, jump: jumpToCard });   // 週次ビューの遷移先
```

`keydown` の Alt ブロック（`v2/src/app.js:493-506`）に週次のキーを追加。`if (e.code === 'Digit0')` の行の前に:

```js
      if (e.code === 'Digit4'){ e.preventDefault(); selectView('weekly'); return; }      // 週次ビュー
```

`if (e.code === 'Digit0')` の行を差し替え（週次では「今週へ」になる）:

```js
      if (e.code === 'Digit0'){                                                          // 週次=今週へ / 他=分割トグル
        e.preventDefault();
        if (currentView === 'weekly'){ weeklyState.wkOff = 0; renderAll(); } else toggleSplit();
        return;
      }
```

Alt+Shift の週送りを、Alt ブロックの直前（`if (e.altKey && !e.ctrlKey && ...` の直前）に追加:

```js
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && currentView === 'weekly'){   // 週送り
      if (e.key === 'ArrowLeft'){ e.preventDefault(); pageWeeks(weeklyState, renderAll, -1); return; }
      if (e.key === 'ArrowRight'){ e.preventDefault(); pageWeeks(weeklyState, renderAll, 1); return; }
    }
```

ナビ履歴に `wkOff` を含める。`navSnapshot`（`v2/src/app.js:56-58`）:

```js
function navSnapshot(){
  return { view: currentView, splitRight, projId: projState.projId, projRoot: projState.rootRef, zoom: getZoom(), dayFocus: getDayFocus(), wkOff: weeklyState.wkOff };
}
```

`navEq`（`v2/src/app.js:59`）の末尾条件に追加:

```js
function navEq(a, b){ return !!a && !!b && a.view===b.view && a.splitRight===b.splitRight && a.projId===b.projId && a.projRoot===b.projRoot && a.zoom===b.zoom && a.dayFocus===b.dayFocus && a.wkOff===b.wkOff; }
```

`navRestore`（`v2/src/app.js:66-73`）の先頭に追加:

```js
  if (snap.wkOff != null) weeklyState.wkOff = snap.wkOff;
```

コマンドパレット（`buildCommands`・`v2/src/app.js:381-394`）の `'表示'` カテゴリに追加:

```js
    { cat:'表示', label:'週次を表示', hint:'Alt+4', roma:'shuuji hyouji weekly', run: () => selectView('weekly') },
    { cat:'週次', label:'前の週へ', hint:'Alt+Shift+←', roma:'zenshuu mae week prev', run: () => { showView('weekly'); pageWeeks(weeklyState, renderAll, -1); } },
    { cat:'週次', label:'次の週へ', hint:'Alt+Shift+→', roma:'jishuu tsugi week next', run: () => { showView('weekly'); pageWeeks(weeklyState, renderAll, 1); } },
    { cat:'週次', label:'今週へ', hint:'Alt+0', roma:'konshuu ima week today', run: () => { weeklyState.wkOff = 0; selectView('weekly'); } },
```

- [ ] **Step 5: `style.css` に `.wk-*` を追加**

`v2/style.css` の末尾に追記:

```css
/* ── 週次ビュー（PJ×週マトリクス）───────────────────────── */
#view-weekly { display:flex; flex-direction:column; min-height:0; overflow:hidden; }
.wk-bar { display:flex; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid var(--bd); flex:0 0 auto; }
.wk-bar .spacer { flex:1; }
.wk-btn { padding:2px 8px; font-size:12px; }
.wk-range { font-size:12px; color:var(--tx3); }
.wk-chk { font-size:12px; color:var(--tx2); display:flex; align-items:center; gap:4px; }
.wk-empty { padding:16px; font-size:13px; color:var(--tx3); }

.wk-scroll { flex:1 1 auto; overflow:auto; min-height:0; }
.wk-table { border-collapse:separate; border-spacing:0; table-layout:fixed; }
.wk-th { position:sticky; top:0; z-index:3; background:var(--bg2); border-right:1px solid var(--bd);
         border-bottom:1px solid var(--bd); font-size:11px; font-weight:700; color:var(--tx2);
         padding:4px 6px; text-align:left; }
.wk-th-now { font-size:10px; font-weight:400; color:var(--ac); }
.wk-c-proj { width:200px; min-width:200px; position:sticky; left:0; z-index:2; background:var(--bg); }
.wk-c-link { width:160px; min-width:160px; position:sticky; left:200px; z-index:2; background:var(--bg); }
.wk-th.wk-c-proj, .wk-th.wk-c-link { z-index:4; background:var(--bg2); }
.wk-c-week { width:220px; min-width:220px; }
.wk-th.wk-current, .wk-cell.wk-current { background:var(--acbg, rgba(80,140,255,.06)); }

.wk-cell { vertical-align:top; border-right:1px solid var(--bd); border-bottom:1px solid var(--bd); padding:4px; }
.wk-row-none .wk-proj-title { color:var(--tx3); font-style:italic; }
.wk-block { margin-bottom:4px; }
.wk-block-h { font-size:10px; font-weight:700; color:var(--tx3); margin:2px 0 1px; }
.wk-b-ms .wk-block-h { color:#c8871a; }
.wk-b-over .wk-block-h { color:#d9534f; }

.wk-item { display:flex; align-items:baseline; gap:4px; font-size:12px; line-height:1.45;
           padding:1px 3px; border-radius:3px; cursor:default; outline:none; }
.wk-item:focus { background:var(--sel, rgba(80,140,255,.16)); box-shadow:inset 0 0 0 1px var(--ac); }
.wk-ph { min-height:18px; }
.wk-ph::after { content:'＋'; color:var(--tx3); font-size:11px; opacity:0; }
.wk-ph:hover::after, .wk-ph:focus::after { opacity:1; }
.wk-tx { flex:1; min-width:0; overflow-wrap:anywhere; }
.wk-tx.done { text-decoration:line-through; color:var(--tx3); }
.wk-dot { width:4px; height:4px; border-radius:50%; background:var(--tx3); flex:0 0 auto; transform:translateY(-2px); }
.wk-cb { margin:0; flex:0 0 auto; }
.wk-badge { font-size:10px; color:var(--tx3); border:1px solid var(--bd); border-radius:3px; padding:0 3px; flex:0 0 auto; }
.wk-i-ms { font-weight:700; background:rgba(200,135,26,.12); border-left:3px solid #c8871a; padding-left:4px; }
.wk-i-over { color:var(--tx2); }
.wk-i-over .wk-from { color:#d9534f; border-color:#d9534f; }

.wk-proj-title { font-weight:700; cursor:pointer; }
.wk-proj-title:hover { text-decoration:underline; }
.wk-proj-kid { color:var(--tx2); cursor:pointer; padding-left:8px; }
.wk-proj-kid::before { content:'・'; color:var(--tx3); }
.wk-proj-kid:hover { text-decoration:underline; }
.wk-proj-move { margin-left:auto; display:none; gap:1px; }
.wk-proj-title:hover .wk-proj-move, .wk-proj-title:focus .wk-proj-move { display:flex; }
.wk-mv { font-size:9px; line-height:1; padding:1px 2px; border:1px solid var(--bd); background:var(--bg2);
         color:var(--tx2); border-radius:2px; cursor:pointer; }
.wk-link { color:var(--tx2); cursor:pointer; }
.wk-link:hover { text-decoration:underline; }
```

- [ ] **Step 6: 実機で表示を確認**

`preview_start` で `weekly-static` を起動し `http://localhost:8123/v2/index.html` を開く。
確認項目:
1. ツールバーに「▦ 週次」が出て、押すと表が表示される（`Alt+4` でも）
2. 週ヘッダが6列（先週〜今週+4）、今週列が強調されている
3. PJ列にPJ名＋直下ノード、リンク列に「リンク」ノードの子が出る
4. 横スクロールしてもPJ列/リンク列が左に残り、縦スクロールでもヘッダが上に残る
5. PJ名クリックでプロジェクトビューへ、直下ノードクリックでそのノードにズームした状態で開く
6. `◀ 前週` / `次週 ▶` / `今週` / `空PJを表示` が効く
7. `read_console_messages` でエラーが無い

- [ ] **Step 7: Run the whole suite**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f" || exit 1; done`
Expected: 全 PASS（純ロジックは変えていないので回帰なし）

- [ ] **Step 8: Commit & push**

```bash
git add v2/src/weekly.js v2/src/clipboard.js v2/src/app.js v2/index.html v2/style.css
git commit -m "feat(v2): 週次ビューの骨格（PJ×週の表・PJ列/リンク列・週送り・空PJ表示・週報コピー）"
git push
```

---

## Task 8: キーボード操作（ナビモード・カーソル・Enter決定・編集モード）

**Files:**
- Modify: `v2/src/weekly.js`
- Modify: `v2/src/app.js`（`onWeeklyKey` の配線）

- [ ] **Step 1: `weekly.js` にカーソル管理とキー処理を追加**

`v2/src/weekly.js` の末尾に追記:

```js
// ── カーソル（ナビモード）──
// 矢印キーでは再描画せず DOM フォーカスだけ動かす（軽快さの維持）。
// データを変えたときだけ requestRender() → 描画後に applyCursor() で復帰する。
let _cursor = { row: null, colIdx: FIRST_WEEK_COL, idx: 0 };
let _shape = { rows: [], cols: [], counts: new Map() };
let _mount = null, _store = null, _render = null, _state = null;

// 描画後に呼ぶ: DOM から shape（行・列・スロット数）を作る
function buildShape(mount, grid){
  const rows = grid.rows.map(r => r.projId || '__none');
  const cols = ['proj', 'link', ...grid.weeks.map(w => w.wk)];
  const counts = new Map();
  for (const rowId of rows) for (const colId of cols){
    const cell = mount.querySelector(`.wk-row[data-row="${cssEsc(rowId)}"] .wk-cell[data-col="${cssEsc(colId)}"]`);
    const n = cell ? cell.querySelectorAll('.wk-item').length : 0;
    counts.set(rowId + '|' + colId, n || 1);
  }
  return { rows, cols, counts };
}
const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s);

function cellEl(rowId, colId){
  return _mount && _mount.querySelector(`.wk-row[data-row="${cssEsc(rowId)}"] .wk-cell[data-col="${cssEsc(colId)}"]`);
}
function itemsAt(rowId, colId){
  const c = cellEl(rowId, colId);
  return c ? [...c.querySelectorAll('.wk-item')] : [];
}
// カーソルの位置に実際にフォーカスを当てる（行/列が消えていたら近傍にクランプ）
export function applyCursor(){
  if (!_shape.rows.length) return;
  if (_shape.rows.indexOf(_cursor.row) < 0) _cursor.row = _shape.rows[0];
  _cursor.colIdx = Math.min(Math.max(_cursor.colIdx | 0, 0), _shape.cols.length - 1);
  const items = itemsAt(_cursor.row, _shape.cols[_cursor.colIdx]);
  if (!items.length) return;
  _cursor.idx = Math.min(Math.max(_cursor.idx | 0, 0), items.length - 1);
  const el = items[_cursor.idx];
  el.focus();
  el.scrollIntoView({ block:'nearest', inline:'nearest' });
}
// クリック/フォーカスでカーソルを同期（マウスとキーの位置がずれないように）
function syncCursorFrom(el){
  const cell = el.closest('.wk-cell'); if (!cell) return;
  const rowEl = el.closest('.wk-row'); if (!rowEl) return;
  const rowId = rowEl.dataset.row, colId = cell.dataset.col;
  const ci = _shape.cols.indexOf(colId);
  if (ci < 0) return;
  _cursor = { row: rowId, colIdx: ci, idx: [...cell.querySelectorAll('.wk-item')].indexOf(el) };
}

// ── 決定（Enter）──
function activate(el){
  const act = el.dataset.act;
  if (act === 'proj'){ const t = el.closest('.wk-cell').querySelector('.wk-proj-title'); void t; _onOpenProject && _onOpenProject(el.closest('.wk-row').dataset.row); return; }
  if (act === 'kid'){ _onOpenProjectAt && _onOpenProjectAt(el.dataset.proj, el.dataset.kidRef); return; }
  if (act === 'link'){ openLink(el); return; }
  if (act === 'add'){ addToCell(el.dataset.row, el.dataset.wk, 'todo'); return; }
  if (act === 'card'){
    if (el.dataset.overRef){ _onJump && _onJump(el.dataset.body); return; }   // 参照行は元の場所へ
    startEdit(el);
  }
}

// ── 編集モード（Enter で開始 / Escape で戻る）──
// contenteditable は「編集中の1行だけ」に付ける（常時ONにしない＝矢印キーがキャレットに食われない）
let _editing = null;      // 編集中の bodyId
function startEdit(el){
  const tx = el.querySelector('.wk-tx'); if (!tx) return;
  const bodyId = el.dataset.body;
  _editing = bodyId;
  el.classList.add('wk-editing');
  tx.contentEditable = 'true';
  tx.spellcheck = false;
  if ((tx.textContent || '') === '(空)') tx.textContent = '';
  tx.focus();
  const r = document.createRange(); r.selectNodeContents(tx); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  tx.oninput = () => _store.updateBody(bodyId, { content: tx.textContent || '' });
  tx.onblur = () => endEdit(el);
  tx.onkeydown = (ev) => {
    if (ev.isComposing) return;
    if (ev.key === 'Escape'){ ev.preventDefault(); ev.stopPropagation(); endEdit(el); el.focus(); return; }
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey){
      ev.preventDefault(); ev.stopPropagation();
      endEdit(el);
      const b = _store.getBody(bodyId);                     // 同じブロックに次の行を作り編集を続ける
      const blockKey = [...el.classList].includes('wk-i-memo') ? 'memo' : 'todo';
      addToCell(el.dataset.row, el.dataset.wk, blockKey, { done: !!(b && b.done) && blockKey === 'todo' ? false : undefined });
      return;
    }
    ev.stopPropagation();                                    // 他のキーはグリッドへ渡さない（通常のテキスト編集）
  };
}
function endEdit(el){
  const tx = el && el.querySelector('.wk-tx');
  if (tx){ tx.contentEditable = 'false'; tx.oninput = null; tx.onblur = null; tx.onkeydown = null; }
  if (el) el.classList.remove('wk-editing');
  _editing = null;
}

// ── セルへの追加 ──
// 今日の day カード直下に作り proj を割当。そのセルが今週以外なら gridWk で表示週を固定する。
export function addToCell(rowId, wk, blockKey, extra){
  if (!_store) return;
  const today = todayStr();
  const day = _store.ensureDayCard(today);
  const attrs = { kind: blockKey === 'memo' ? 'memo' : 'task', content: '', parentRefId: day.ref.id };
  if (rowId && rowId !== '__none') attrs.proj = rowId;
  if (blockKey === 'done') attrs.done = true;
  if (extra && extra.done !== undefined) attrs.done = extra.done;
  if (wk && wk !== weekStart(today)) attrs.gridWk = wk;      // 今週以外のセル＝表示週を明示
  const { body } = _store.createCard(attrs);
  _render();
  const el = _mount && _mount.querySelector(`.wk-item[data-body="${cssEsc(body.id)}"]`);
  if (el){ syncCursorFrom(el); el.focus(); startEdit(el); }
  else showToast('追加しました（現在の表示範囲では見えません）');
}

// ── キー処理（app.js の keydown から呼ばれる）──
// 戻り値 true = 処理した（app 側で preventDefault 済み扱い）
export function onWeeklyKey(e){
  if (_editing) return false;                                // 編集中は編集側のハンドラに任せる
  const el = document.activeElement;
  if (!el || !el.classList || !el.classList.contains('wk-item')) return false;
  if (e.isComposing) return false;
  const plain = !e.altKey && !e.ctrlKey && !e.metaKey;

  // 移動系
  const navKey = (e.key === 'Tab') ? (e.shiftKey ? 'ShiftTab' : 'Tab')
               : (plain && !e.shiftKey) ? e.key : null;
  if (navKey && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab','ShiftTab','Home','End'].includes(navKey)){
    syncCursorFrom(el);
    const { cursor, page } = moveCursor(_shape, _cursor, navKey);
    _cursor = cursor;
    if (page){ pageWeeks(_state, _render, page); return true; }   // 週送り→再描画→applyCursor で端に乗る
    applyCursor();
    return true;
  }
  if (plain && !e.shiftKey && e.key === 'Enter'){ activate(el); return true; }
  if (plain && !e.shiftKey && e.key === ' '){ toggleDoneAt(el); return true; }
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'Enter'){ toggleDoneAt(el); return true; }
  if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'm' || e.key === 'M')){ toggleMsAt(el); return true; }
  if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'ArrowDown'){ expandAt(el); return true; }
  if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')){
    moveCardWeek(el, e.key === 'ArrowRight' ? 1 : -1); return true;
  }
  if (e.key === 'Escape'){ if (_state.expanded){ _state.expanded = null; _render(); applyCursor(); return true; } }
  return false;
}
function toggleDoneAt(el){
  if (el.dataset.act !== 'card') return;
  const b = _store.getBody(el.dataset.body); if (!b || b.kind !== 'task') return;
  syncCursorFrom(el);
  _store.updateBody(b.id, { done: !b.done });
  _render(); applyCursor();
}
function toggleMsAt(el){
  if (el.dataset.act !== 'card') return;
  const b = _store.getBody(el.dataset.body); if (!b) return;
  syncCursorFrom(el);
  _store.updateBody(b.id, { content: toggleMsContent(b.content) });
  _render(); applyCursor();
}
function expandAt(el){ void el; }        // Task 10 で実装
function moveCardWeek(el, d){ void el; void d; }   // Task 11 で実装
```

- [ ] **Step 2: `renderWeeklyView` の末尾で shape を作りカーソルを復帰させる**

`v2/src/weekly.js` の `renderWeeklyView` の中、`mount.appendChild(scroll);` の直後に挿入:

```js
  _mount = mount; _store = store; _render = requestRender; _state = state;
  _shape = buildShape(mount, grid);
  if (_cursor.row == null && grid.rows.length) _cursor = { row: _shape.rows[0], colIdx: FIRST_WEEK_COL, idx: 0 };
  mount.addEventListener('focusin', (ev) => {                     // クリック等でもカーソルを同期
    const it = ev.target.closest && ev.target.closest('.wk-item');
    if (it && !_editing) syncCursorFrom(it);
  });
  setTimeout(applyCursor, 0);                                     // 描画完了後にフォーカスを戻す
```

- [ ] **Step 3: `app.js` の keydown で `onWeeklyKey` を最優先に呼ぶ**

`v2/src/app.js` の `document.addEventListener('keydown', (e) => {` の直後（Alt判定より前）に挿入:

```js
    if (currentView === 'weekly' && !splitOn){                    // 週次ビューのグリッド操作を先に処理
      if (onWeeklyKey(e)){ e.preventDefault(); return; }
    }
```

- [ ] **Step 4: `style.css` に編集中のスタイルを追加**

`v2/style.css` の週次ブロックの末尾に追記:

```css
.wk-item.wk-editing { background:var(--bg2); box-shadow:inset 0 0 0 1px var(--ac); }
.wk-item.wk-editing .wk-tx { outline:none; }
```

- [ ] **Step 5: 実機でキー操作を確認**

`http://localhost:8123/v2/index.html` を再読込し `Alt+4`。確認項目:
1. `↓` でセル内を進み、最下段でさらに `↓` すると**次のPJの同じ週のセル先頭**へ移る
2. `↑` で最上段からさらに `↑` すると前のPJのセル**末尾**へ移る
3. `←` `→` で PJ列 → リンク列 → 週1 … と移動し、縦位置が保たれる
4. 右端でさらに `→`、左端でさらに `←` すると**週送りされて新しく現れた列にフォーカスが乗る**
5. `Tab` / `Shift+Tab` でセル単位に送れる。`Home` / `End` で行の端へ
6. `Enter` でカードは編集開始、PJ名はPJを開く、リンクはURLを開く、空セルは追加
7. 編集中に `Enter` で次の行が作られ編集が続く。`Escape` でナビモードに戻る
8. `Space` / `Ctrl+Enter` で完了トグル（✓やったこと ブロックへ移動する）
9. `Alt+M` でマイルストーンのトグル（🏁 ブロックの先頭に移る）
10. 矢印キーの連打が軽い（再描画されていない）
11. `read_console_messages` でエラーが無い

- [ ] **Step 6: Run the whole suite**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f" || exit 1; done`
Expected: 全 PASS

- [ ] **Step 7: Commit & push**

```bash
git add v2/src/weekly.js v2/src/app.js v2/style.css
git commit -m "feat(v2): 週次ビューのキー操作（ナビモード・端で週送り・Enter決定・インライン編集・完了/MSトグル）"
git push
```

---

## Task 9: セルの `＋` 追加ボタンとブロック単位の追加

**Files:**
- Modify: `v2/src/weekly.js`

- [ ] **Step 1: ブロック見出しに `＋` を付ける**

`v2/src/weekly.js` の `buildWeekCell` の中、`bl.appendChild(h);` の直後に挿入:

```js
    if (B.add){                                     // ブロック見出しの右に「＋」（このブロックに追加）
      const plus = document.createElement('button');
      plus.type = 'button'; plus.className = 'wk-add'; plus.textContent = '＋';
      plus.title = B.label.replace(/^\S+\s/, '') + 'に追加';
      plus.onclick = (ev) => { ev.stopPropagation(); addToCell(row.projId || '__none', w.wk, B.key); };
      h.appendChild(plus);
    }
```

さらに、空でないセルでも下端から追加できるように、`buildWeekCell` の `if (!n){` ブロックの**前**に挿入:

```js
  if (n){                                           // 空でないセルにも末尾の追加行を置く
    const add = document.createElement('div');
    add.className = 'wk-item wk-ph wk-add-row'; add.tabIndex = -1; add.dataset.act = 'add';
    add.dataset.row = row.projId || '__none'; add.dataset.wk = w.wk;
    add.title = 'Enter / クリックでこの週にタスクを追加';
    add.onclick = () => addToCell(row.projId || '__none', w.wk, 'todo');
    td.appendChild(add);
  }
```

- [ ] **Step 2: 空セルのプレースホルダにもクリックを付ける**

`buildWeekCell` の `if (!n){` ブロックの `td.appendChild(ph);` の直前に挿入:

```js
    ph.onclick = () => addToCell(row.projId || '__none', w.wk, 'todo');
```

- [ ] **Step 3: `style.css` に `＋` のスタイルを追加**

`v2/style.css` の週次ブロックの末尾に追記:

```css
.wk-block-h { display:flex; align-items:center; gap:4px; }
.wk-add { margin-left:auto; font-size:10px; line-height:1; padding:0 3px; border:1px solid var(--bd);
          background:var(--bg2); color:var(--tx2); border-radius:2px; cursor:pointer; opacity:0; }
.wk-cell:hover .wk-add, .wk-block-h:hover .wk-add { opacity:1; }
.wk-add-row { min-height:14px; }
```

- [ ] **Step 4: 実機で確認**

1. セルにマウスを乗せるとブロック見出しに `＋` が出て、押すとそのブロックの種類でカードが作られ**即編集**になる
2. 「やったこと」の `＋` で作ると完了済みタスクになる（`✓` が付く）
3. 今週以外のセルに追加したカードが**そのセルに留まる**（`gridWk` が効いている）
4. デイリービュー（`Alt+2`）に切り替えると、作ったカードが**今日の日**に存在する
5. 空セルの `Enter` / クリックでも追加できる
6. `read_console_messages` でエラーが無い

- [ ] **Step 5: Run the whole suite**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f" || exit 1; done`
Expected: 全 PASS

- [ ] **Step 6: Commit & push**

```bash
git add v2/src/weekly.js v2/style.css
git commit -m "feat(v2): 週次ビューのブロック単位の追加（＋／空セル／gridWkで表示週を固定）"
git push
```

---

## Task 10: セルの展開（実体アウトライン）

**Files:**
- Modify: `v2/src/weekly.js`

- [ ] **Step 1: 展開状態を持ち、展開中のセルだけ `renderChildren` に差し替える**

`v2/src/weekly.js` の `buildWeekCell` の先頭（`const cell = row.cells[w.wk];` の直後）に挿入:

```js
  const expKey = (row.projId || '__none') + '|' + w.wk;
  if (state.expanded === expKey){                    // 展開中: 実体アウトライン（daily.js の描画をそのまま使う）
    td.classList.add('wk-expanded');
    const head = document.createElement('div'); head.className = 'wk-exp-head';
    const t = document.createElement('span'); t.textContent = '⤢ ' + w.label + '（Escapeで戻る）';
    head.appendChild(t);
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'wk-add'; close.textContent = '×'; close.title = '畳む（Escape）';
    close.style.opacity = '1';
    close.onclick = () => { state.expanded = null; requestRender(); };
    head.appendChild(close);
    td.appendChild(head);
    // 参照行（over）は実体として描かない＝同一 refId を DOM に2つ作らない
    const refs = [];
    for (const B of BLOCKS){ if (B.ref) continue; for (const e of (cell[B.key] || [])) refs.push(e.ref); }
    if (refs.length) renderChildren(store, null, td, 0, requestRender, { refs, mirrorRoot: true });
    else { const p = document.createElement('div'); p.className = 'wk-exp-empty'; p.textContent = '(この週のカードはありません)'; td.appendChild(p); }
    setNavContainer(td, requestRender);              // ↑↓ が別ビューのコンテナを掴まないように（v0.93.0の教訓）
    return td;
  }
```

- [ ] **Step 2: 展開ボタンとキー（`Alt+↓`）を配線**

`buildWeekCell` の最後（`return td;` の直前）に挿入:

```js
  if (n){                                            // セル右上の ⤢（展開）
    const ex = document.createElement('button');
    ex.type = 'button'; ex.className = 'wk-exp-btn'; ex.textContent = '⤢';
    ex.title = 'このセルを展開して編集（Alt+↓）';
    ex.onclick = (ev) => { ev.stopPropagation(); state.expanded = expKey; requestRender(); };
    td.appendChild(ex);
  }
```

`expandAt` のスタブを実装に差し替え:

```js
function expandAt(el){
  const cell = el.closest('.wk-cell'); if (!cell) return;
  const rowId = el.closest('.wk-row')?.dataset.row, colId = cell.dataset.col;
  if (!rowId || !colId || colId === 'proj' || colId === 'link') return;
  syncCursorFrom(el);
  _state.expanded = rowId + '|' + colId;
  _render();
  const fc = _mount.querySelector('.wk-expanded .card-txt');   // 展開後は先頭カードへ
  if (fc && fc.dataset.ref) focusCard(fc.dataset.ref, 0);
}
```

- [ ] **Step 3: `style.css` に展開セルのスタイルを追加**

`v2/style.css` の週次ブロックの末尾に追記:

```css
.wk-cell { position:relative; }
.wk-exp-btn { position:absolute; top:2px; right:2px; font-size:10px; line-height:1; padding:0 3px;
              border:1px solid var(--bd); background:var(--bg2); color:var(--tx2); border-radius:2px;
              cursor:pointer; opacity:0; }
.wk-cell:hover .wk-exp-btn { opacity:1; }
.wk-cell.wk-expanded { box-shadow:inset 0 0 0 2px var(--ac); background:var(--bg); }
.wk-exp-head { display:flex; align-items:center; gap:4px; font-size:10px; font-weight:700;
               color:var(--ac); margin-bottom:2px; }
.wk-exp-empty { font-size:11px; color:var(--tx3); }
.wk-cell.wk-expanded .card-row { font-size:12px; }
```

- [ ] **Step 4: 実機で確認**

1. セルにマウスを乗せると右上に `⤢` が出て、押すと**そのセルだけ**実体アウトラインになる
2. ナビモードで `Alt+↓` でも展開でき、展開後は先頭カードにフォーカスが当たる
3. 展開セル内で `↑↓` の移動・`Tab` のインデント・`Ctrl+↑↓` の折りたたみ・`⋯` メニューが**デイリーと同じに**動く
4. 展開セルに「↩ 期限切れ」のカードが**実体として現れない**（重複しない）
5. `Escape` または `×` で畳んでナビモードに戻る
6. 同時に展開できるのは1セルだけ（別のセルを展開すると前のが畳まれる）
7. 展開セルで編集した内容がデイリービューにも反映されている
8. `read_console_messages` でエラーが無い

- [ ] **Step 5: Run the whole suite**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f" || exit 1; done`
Expected: 全 PASS

- [ ] **Step 6: Commit & push**

```bash
git add v2/src/weekly.js v2/style.css
git commit -m "feat(v2): 週次ビューのセル展開（renderChildren を流用・繰越は実体化しない・setNavContainer）"
git push
```

---

## Task 11: 週の付け替え（D&D と `Ctrl+Shift+←/→` の延期）

**Files:**
- Modify: `v2/src/weekly.js`

- [ ] **Step 1: 週を付け替える共通ロジックを追加**

`v2/src/weekly.js` の末尾に追記:

```js
// ── 週の付け替え ──
// 期限があるカードは期限そのものを移動先週の同じ曜日へずらす（期限が意味を持つため）。
// 期限が無いカードは ref.gridWk で表示週だけを固定する。
export function setCardWeek(store, ref, body, wk){
  if (body.due){
    const cur = weekStart(body.due);
    const offsetDays = Math.round((Date.parse(body.due + 'T00:00:00') - Date.parse(cur + 'T00:00:00')) / 86400000);
    store.updateBody(body.id, { due: shiftDaysStr(wk, offsetDays) });
    if (ref.gridWk) store.updateRef(ref.id, { gridWk: undefined });   // 期限が正になるので上書きは外す
  } else {
    store.updateRef(ref.id, { gridWk: wk });
  }
}
const shiftDaysStr = (wk, n) => {
  const d = new Date(Date.parse(wk + 'T00:00:00'));
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};
// PJを付け替える（別PJ行へのドロップ）
export function setCardProj(store, body, projId){
  store.updateBody(body.id, { proj: projId && projId !== '__none' ? projId : undefined });
}
```

- [ ] **Step 2: `moveCardWeek` のスタブを実装に差し替え**

`v2/src/weekly.js` の `function moveCardWeek(el, d){ void el; void d; }` を差し替え:

```js
function moveCardWeek(el, d){
  if (el.dataset.act !== 'card' || el.dataset.overRef) return;    // 参照行は動かさない
  const ref = _store.getRef(el.dataset.itemRef);
  const body = _store.getBody(el.dataset.body);
  if (!ref || !body) return;
  const cell = el.closest('.wk-cell');
  const cur = cell && cell.dataset.col;
  if (!cur || cur === 'proj' || cur === 'link') return;
  syncCursorFrom(el);
  setCardWeek(_store, ref, body, weekAdd(cur, d));
  _render(); applyCursor();
  showToast(d > 0 ? '翌週へ移しました' : '前の週へ移しました');
}
```

- [ ] **Step 3: 行の `⏩`（延期）ボタンを追加**

`v2/src/weekly.js` の `buildItem` の中、`return it;` の直前に挿入:

```js
  if (!B.ref && e.body.kind === 'task'){               // ⏩ 翌週へ延期
    const pp = document.createElement('button');
    pp.type = 'button'; pp.className = 'wk-pp'; pp.textContent = '⏩';
    pp.title = '翌週へ延期（Ctrl+Shift+→）';
    pp.onclick = (ev) => {
      ev.stopPropagation();
      setCardWeek(store, e.ref, e.body, weekAdd(w.wk, 1));
      requestRender();
      showToast('翌週へ移しました');
    };
    it.appendChild(pp);
  }
  if (_onJump){                                        // ↗ 元の場所（デイリー）へ
    const jb = document.createElement('button');
    jb.type = 'button'; jb.className = 'wk-jump'; jb.textContent = '↗';
    jb.title = '元の場所（デイリー）へ';
    jb.onmousedown = (ev) => ev.preventDefault();
    jb.onclick = (ev) => { ev.stopPropagation(); _onJump(e.body.id); };
    it.appendChild(jb);
  }
```

- [ ] **Step 4: セル間のドラッグ＆ドロップを追加**

`v2/src/weekly.js` の `buildItem` の中、`it.dataset.act = 'card';` を含むブロックの後（`if (B.ref) ... else ...` の行の直後）に挿入:

```js
  if (!B.ref){                                         // 参照行はドラッグ元にしない
    it.draggable = true;
    it.addEventListener('dragstart', (ev) => {
      _dragItem = { refId: e.ref.id, bodyId: e.body.id };
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', e.body.id); } catch(_){}
    });
    it.addEventListener('dragend', () => { _dragItem = null; clearDropHi(); });
  }
```

`buildWeekCell` の `const cell = row.cells[w.wk];` の直後（展開判定の後）に挿入:

```js
  setupCellDrop(td, store, requestRender, row.projId || '__none', w.wk);
```

`v2/src/weekly.js` の末尾に追記:

```js
// ── セルへのドロップ（週の付け替え／別PJ行なら proj も変更）──
let _dragItem = null, _dropHi = null;
function clearDropHi(){ if (_dropHi){ _dropHi.classList.remove('wk-drop'); _dropHi = null; } }
function setupCellDrop(td, store, requestRender, rowId, wk){
  td.addEventListener('dragover', (ev) => {
    if (!_dragItem) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    if (_dropHi !== td){ clearDropHi(); td.classList.add('wk-drop'); _dropHi = td; }
  });
  td.addEventListener('dragleave', () => { if (_dropHi === td) clearDropHi(); });
  td.addEventListener('drop', (ev) => {
    if (!_dragItem) return;
    ev.preventDefault(); clearDropHi();
    const ref = store.getRef(_dragItem.refId), body = store.getBody(_dragItem.bodyId);
    _dragItem = null;
    if (!ref || !body) return;
    const curProj = body.proj || '__none';
    if (curProj !== rowId) setCardProj(store, body, rowId);      // 別PJ行へ＝割当を変更
    setCardWeek(store, ref, body, wk);
    requestRender();
    showToast(curProj !== rowId ? 'プロジェクトと週を変更しました' : '週を変更しました');
  });
}
```

- [ ] **Step 5: `style.css` にボタンとドロップ表示を追加**

`v2/style.css` の週次ブロックの末尾に追記:

```css
.wk-pp, .wk-jump { font-size:10px; line-height:1; padding:0 2px; border:1px solid var(--bd);
                   background:var(--bg2); color:var(--tx2); border-radius:2px; cursor:pointer;
                   opacity:0; flex:0 0 auto; }
.wk-item:hover .wk-pp, .wk-item:hover .wk-jump,
.wk-item:focus .wk-pp, .wk-item:focus .wk-jump { opacity:1; }
.wk-cell.wk-drop { box-shadow:inset 0 0 0 2px var(--ac); }
.wk-item[draggable="true"] { cursor:grab; }
```

- [ ] **Step 6: 実機で確認**

1. カードを別の週のセルへドラッグすると週が移る（ドロップ先が枠線で示される）
2. 期限があるカードをドラッグすると**期限自体が移動先週の同じ曜日に更新**される（📅バッジが変わる）
3. 期限が無いカードは期限が付かず、そのセルに留まる（デイリーでは元の日のまま）
4. 別PJの行のセルへドラッグすると**PJ割当も変わる**
5. `⏩` と `Ctrl+Shift+→` で翌週へ、`Ctrl+Shift+←` で前の週へ移る
6. 「↩ 期限切れ」の参照行はドラッグできず `⏩` も出ない（`↗` で元の場所へ飛べる）
7. `read_console_messages` でエラーが無い

- [ ] **Step 7: Run the whole suite**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f" || exit 1; done`
Expected: 全 PASS

- [ ] **Step 8: Commit & push**

```bash
git add v2/src/weekly.js v2/style.css
git commit -m "feat(v2): 週の付け替え（D&D・⏩延期・Ctrl+Shift+←→）と↗元の場所へ"
git push
```

---

## Task 12: 仕上げ（CHANGELOG・全体の通し確認）

**Files:**
- Modify: `v2/CHANGELOG.md`

- [ ] **Step 1: 全テストを通す**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f" || exit 1; done`
Expected: 39本すべて `PASS ...`

- [ ] **Step 2: 既存ビューの回帰確認（実機）**

`http://localhost:8123/v2/index.html` で、週次ビュー以外が壊れていないことを確認:

1. `Alt+2` デイリー: カードの追加・編集・`Tab`/`Shift+Tab`・`Ctrl+Enter`・`⋯`メニューが従来通り
2. `Alt+1` リスト: 絞り込み・保存ビュー・キーワード検索が従来通り
3. `Alt+3` プロジェクト: 一覧→PJページ→📌割当カードが従来通り
4. `Alt+?`（🔍検索）: インクリメンタル検索が従来通り
5. `Alt+0` で分割表示が従来通り開く（週次以外のビューにいるとき）
6. 週次を開いた後に `Alt+0` を押すと「今週へ」になり、分割はトグルされない
7. `Alt+H` の完了非表示が週次の「やること/メモ/期限切れ」に効き、「やったこと」には効かない
8. `Ctrl+Z` / `Ctrl+Y` で週次での変更が取り消せる
9. `Alt+←` / `Alt+→` のナビ履歴で週送りも戻れる
10. リロードしても週次ビューと週オフセットが復元される
11. `read_console_messages` でエラーが無い

- [ ] **Step 3: `CHANGELOG.md` にエントリを追加**

`v2/CHANGELOG.md` の `# Tracker v2 — CHANGELOG` の直後に挿入:

```markdown
## v0.95.0 — 週次ビュー（プロジェクト×週のマトリクス）を追加（2026-07-26）

縦=プロジェクト / 横=週 で「その週にやること・やったこと・メモ・マイルストーン・期限切れ」を串刺し管理できる
週次ビューを新設。設計は `docs/superpowers/specs/2026-07-26-weekly-view-design.md`。

- **派生ビュー方式（`week.js` 新規）**: データの正はデイリー/PJページのカードのまま。`store.js` は無変更。
  週キー計算・PJ×週の集約・カーソル移動・週報生成を **DOM非依存の純ロジック**として `week.js` に集約
  （依存は `props.js` のみ＝循環なし）。単体テスト6本を追加。
- **セルの構造**: 1セルを 🏁マイルストーン / □やること / ✓やったこと / 📝メモ / ↩期限切れ の5ブロックに区切る。
  所属週は `ref.gridWk` > `body.due` > 出所日 > `createdAt` の優先順位。
  **「やったこと」だけは完了日（`doneAt`）の週**に入る＝未完了は予定週・完了は実施週。
- **期限切れの繰越**: 未完了タスクは完了するまで毎週繰り越して各週の下部に出る（元の週にも残す＝履歴が消えない）。
  繰越行は**参照行**として描き `data-ref` を付けない（同一 refId が DOM に2つあると `focusCard` が誤爆するため）。
- **キー操作で完結**: セル内の各アイテムをフォーカス可能行にし、`↑↓` は列内を連続移動（セル最下段で次のPJへ）、
  `←→` は行内を移動（端でさらに押すと**週送りして新しく現れた列にフォーカス**）。`Enter` で決定
  （カード=編集開始／PJ名=PJを開く／リンク=URL／空セル=追加）、`Space`/`Ctrl+Enter`=完了、`Alt+M`=マイルストーン、
  `Ctrl+Shift+←→`=週の移動、`Alt+↓`=セル展開。**矢印キーでは再描画せず DOM フォーカスだけ動かす**（軽快さの維持）。
- **ハイブリッドなセル**: 既定はコンパクト行（チェック＋インライン編集）。`Alt+↓`/`⤢` でそのセルだけ
  `daily.js` の `renderChildren` に差し替え、子・折りたたみ・`⋯`メニュー・D&Dをそのまま使える（同時に1セルだけ）。
  展開時は `setNavContainer` を呼ぶ（v0.93.0 の教訓）。
- **PJ列とリンク列**: PJ名はPJページへのリンク、その下に直下ノード（各行が直リンク）。直下の「リンク」ノードの
  **子**は右隣のリンク列に一覧（`url` があれば別タブ）。両列は sticky で常に左に残る。並び順はPJ一覧準拠で `▲▼` で入替。
- **その他**: 週送り（`Alt+Shift+←→`・`Alt+0`で今週）、D&Dとで週/PJの付け替え（期限があれば期限自体をずらす）、
  `⏩`翌週へ延期、空PJの表示切替、未割当行（PJ割当漏れの未完了タスク）、`📋 週報コピー`（HTML＋テキスト）。
  `Alt+H` の完了非表示は「やったこと」ブロックには適用しない（完了専用ブロックなので常に空になるため）。
- 触っていない箇所: `store.js` / `daily.js` / `list.js` / `project.js` / `query.js` / `search.js` / `props.js` は無変更
  （`clipboard.js` は `copyRichText` の追加のみ・既存の copy/paste 経路は不変）。
- 検証: 単体テスト**39ファイル全PASS**。実機（localhost:8123）で週次の表示・キー操作一巡・追加/編集/完了/MS・
  セル展開・D&D・延期・週送り・週報コピー・リロード復元を確認。既存4ビューと分割表示・`Alt+H`・undo/redo・
  ナビ履歴の回帰も確認。コンソールエラーなし。
```

- [ ] **Step 4: Commit & push**

```bash
git add v2/CHANGELOG.md
git commit -m "docs(v2): CHANGELOG に v0.95.0（週次ビュー）を追記"
git push
```

---

## Self-Review

**1. Spec coverage**

| spec の要件 | 対応タスク |
|---|---|
| 週キー（月曜始まり・6週・先週から） | Task 1 |
| 所属週の優先順位（`gridWk`>`due`>出所日>`createdAt`） | Task 2 |
| マイルストーン（タグ・週次からトグル） | Task 2（判定/トグル）・Task 8（`Alt+M`） |
| 集約・5ブロック分類・やったこと=完了週 | Task 3 |
| PJ列の直下ノード・リンク列（「リンク」ノードの子） | Task 3（データ）・Task 7（描画） |
| 未割当行 | Task 3・Task 7 |
| 期限切れ繰越（完了まで毎週・MS除外・未来週に出さない） | Task 3（実装）・Task 4（仕様固定） |
| カーソル移動（縦連続・行またぎ・端で週送り） | Task 5・Task 8 |
| 週報コピー | Task 6（生成）・Task 7（`copyRichText`とボタン） |
| 表の骨格・sticky・今週強調・`Alt+4`・分割解除 | Task 7 |
| キー操作一式（Enter決定・編集モード・Space/Ctrl+Enter） | Task 8 |
| セルへの追加（今日のday直下＋proj＋gridWk） | Task 8（`addToCell`）・Task 9（UI） |
| セル展開（`renderChildren`・1セルのみ・`setNavContainer`・繰越は実体化しない） | Task 10 |
| 週/PJの付け替え（D&D・⏩延期） | Task 11 |
| `Alt+H` は「やったこと」に適用しない | Task 7（`buildWeekCell`） |
| 状態の localStorage 保存（undo/同期に乗せない） | Task 7（`savePrefs`/`loadWeeklyPrefs`） |
| ナビ履歴に `wkOff` | Task 7 |
| PJ行の `▲▼` 並べ替え | Task 7（`buildProjCell`） |
| 空PJを隠す | Task 3（`hideEmpty`）・Task 7（UI） |

漏れなし。

**2. Placeholder scan**

`expandAt` / `moveCardWeek` は Task 8 で意図的にスタブ（`void el;`）にし、Task 10 / Task 11 で
実装コードを丸ごと示して差し替えている。それ以外に TBD・「適切に処理」等の曖昧な指示は無い。

**3. Type consistency**

- `week.js` の export: `WEEK_COUNT` / `WEEK_BACK` / `MS_TAG` / `shiftDays` / `weekStart` / `weekAdd` /
  `weekLabel` / `weeksFor` / `cardWeekOf` / `isMilestone` / `toggleMsContent` / `buildWeeklyGrid` /
  `FIRST_WEEK_COL` / `slotCount` / `moveCursor` / `buildWeekReport` — Task 7 の import 行と一致。
- `weekly.js` の export: `renderWeeklyView` / `setWeeklyHandlers` / `loadWeeklyPrefs` / `pageWeeks` /
  `applyCursor` / `addToCell` / `onWeeklyKey` / `openLink` / `setCardWeek` / `setCardProj` —
  `app.js` が import するのは `renderWeeklyView` / `loadWeeklyPrefs` / `setWeeklyHandlers` / `pageWeeks` /
  `onWeeklyKey` の5つで、すべて定義済み。
- `entry` の形（`{ ref, body, day, wk }`）は Task 3 の生成・Task 6 の週報・Task 7 の描画で一致。
- `cursor` の形（`{ row, colIdx, idx }`）は Task 5 のテスト・実装と Task 8 の利用で一致。
- DOM 属性: `data-row`（`.wk-row` と `.wk-cell` の両方）/ `data-col` / `data-act` / `data-body` /
  `data-itemRef`（→ `dataset.itemRef`）/ `data-overRef`（→ `dataset.overRef`）/ `data-kidRef` / `data-wk` /
  `data-url` を、生成側（Task 7/9）と参照側（Task 8/10/11）で揃えている。
