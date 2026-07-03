# Tracker v2 追加機能5件 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** リストの中項目候補をPJ内に限定・メモ直下タスクの中項目自動継承・リストからのタスク追加・リストD&Dでの中項目移動・リンクを保ったコピー、の5機能を既存構造を壊さず追加する。

**Architecture:** 変更は `store.js`(createCardのmid継承)・`list.js`(候補絞込/追加/D&D)・`clipboard.js`(リンク保持コピー)・`style.css`(見た目) への局所的追加。純ロジックは export して node の単体テスト（`node:assert/strict`）で検証し、UI結線は実機evalで確認。既存の描画・永続・履歴経路（すべて `store` の既存API経由）に乗せる。

**Tech Stack:** Vanilla ES modules（ビルド無し）、テストは `node tests/<name>.test.mjs`（自己実行スクリプト・runnerなし）。

---

## 前提知識（実装者向け）

- データモデル: **body**(内容: `kind`=`memo`/`task`/`day`/`project`/`table`/`image`, `content`, `proj`=所属PJのbody id, `mid`=中項目文字列, `due`, `prio`, `done`/`doneAt`, `url`/`bold`/`color`)、**ref**(ツリー位置: `bodyId`, `parentRefId`, `order`)。1 body を複数 ref で参照＝ミラー。
- 中項目 `mid` はタスク本体の自由入力文字列。リストの `state.sort==='proj'`（ツリー表示=`grouped`）のとき PJ見出し／中項目見出しで階層表現する。
- テストは各ファイルが `console.log('PASS xxx')` で終わる自己実行スクリプト。実行は作業ディレクトリ `v2/` から `node tests/<name>.test.mjs`。
- 作業前に必ず全テスト緑を確認: `for f in tests/*.test.mjs; do node "$f"; done`（すべて PASS）。
- コミットはリポジトリのルート（`v2/` の1つ上）で行う。`git add v2/...`。

---

## File Structure

- `v2/src/store.js` — `createCard` に中項目の作成時継承を追加（#2）。
- `v2/src/list.js` — `midsForProject`（#5）、`addTaskToday`＋追加UI（#4）、`canDropTask`＋D&D結線（#1）。
- `v2/src/clipboard.js` — `serializeSubtree`/`encodeClipHtml`/`insertNodes` 拡張＋メンション解決（#3）。
- `v2/style.css` — 追加行・D&Dハイライトの見た目。
- `v2/tests/store.midinherit.test.mjs`（#2）、`v2/tests/list.midsuggest.test.mjs`（#5）、`v2/tests/list.addtask.test.mjs`（#4）、`v2/tests/list.dnd.test.mjs`（#1）、`v2/tests/clipboard.copy.test.mjs`（#3）— 新規テスト。
- `v2/CHANGELOG.md` — 各機能の記録。

---

## Task 1: #5 中項目候補をPJ内に限定 — `midsForProject`

**Files:**
- Modify: `v2/src/list.js`（純ロジックを追加 export・詳細ポップアップ `buildDetailFields` の datalist 差し替え）
- Test: `v2/tests/list.midsuggest.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`v2/tests/list.midsuggest.test.mjs` を新規作成:

```js
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node tests/list.midsuggest.test.mjs`（作業ディレクトリ `v2/`）
Expected: FAIL（`midsForProject` is not a function / undefined）

- [ ] **Step 3: `midsForProject` を実装**

`v2/src/list.js` の `// ── 純ロジック（テスト対象）──`（10行目付近）の直後に追加:

```js
// 指定PJ（body.proj===projId）のタスクの中項目を重複排除・ソートして返す。projId 空＝未所属タスクの中項目。
export function midsForProject(store, projId){
  const want = projId || '';
  return [...new Set(
    store.queryBodies(b => b.kind === 'task' && (b.proj || '') === want)
      .map(b => b.mid).filter(Boolean)
  )].sort();
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node tests/list.midsuggest.test.mjs`
Expected: `PASS list.midsuggest`

- [ ] **Step 5: 詳細ポップアップの中項目欄をPJ内候補に差し替え**

`v2/src/list.js` の `buildDetailFields`（785行付近）の中項目欄を、グローバル `pwt2-mids` から body専用の datalist に変更する。

変更前（793-795行付近）:
```js
  const mid = document.createElement('input'); mid.type = 'text'; mid.className = 'td-input'; mid.value = body.mid || ''; mid.setAttribute('list', 'pwt2-mids');
  mid.addEventListener('change', () => store.updateBody(body.id, { mid: mid.value.trim() || undefined }));
  add('中項目', mid);
```

変更後:
```js
  const midDl = document.createElement('datalist'); midDl.id = 'pwt2-mids-' + body.id;
  midsForProject(store, body.proj || '').forEach(m => { const o = document.createElement('option'); o.value = m; midDl.appendChild(o); });
  const mid = document.createElement('input'); mid.type = 'text'; mid.className = 'td-input'; mid.value = body.mid || ''; mid.setAttribute('list', midDl.id);
  mid.addEventListener('change', () => store.updateBody(body.id, { mid: mid.value.trim() || undefined }));
  add('中項目', mid);
  grid.appendChild(midDl);
```

（注: `buildDetailFields` 冒頭の `grid` に datalist を append する。フィルタ入力(426行付近)の `pwt2-mids` は横断のまま変更しない。）

- [ ] **Step 6: 実機で候補がPJ内に限定されることを確認（任意・ブラウザ）**

デイリー等でタスクを作りPJと中項目を数件設定→リストでそのタスクの詳細ポップアップ（Alt+Enter）を開き、中項目欄の候補が同一PJのものだけになることを確認。

- [ ] **Step 7: コミット**

```bash
git add v2/src/list.js v2/tests/list.midsuggest.test.mjs
git commit -m "feat(v2): scope 中項目 suggestions to the task's project (#5)"
```

---

## Task 2: #2 メモ直下タスクの中項目を親メモ名に（作成時のみ）

**Files:**
- Modify: `v2/src/store.js:73`（`createCard`）
- Test: `v2/tests/store.midinherit.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`v2/tests/store.midinherit.test.mjs` を新規作成:

```js
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-07-03' });

// メモ配下に作ったカード → 親メモ content が mid に（作成時1回）
const memo = s.createCard({ kind:'memo', content:'見積フェーズ', parentRefId: day.ref.id });
const child = s.createCard({ kind:'memo', content:'子', parentRefId: memo.ref.id });
assert.equal(s.getBody(child.body.id).mid, '見積フェーズ', 'メモ配下→親メモ名を継承');

// day 直下は継承しない
const top = s.createCard({ kind:'memo', content:'直下', parentRefId: day.ref.id });
assert.equal(s.getBody(top.body.id).mid, undefined, 'day直下は継承しない');

// project 直下は継承しない
const proj = s.createProject('PJ');
const page = s.ensureProjectPage(proj.id);
const pchild = s.createCard({ kind:'memo', content:'PJ子', parentRefId: page.ref.id });
assert.equal(s.getBody(pchild.body.id).mid, undefined, 'project直下は継承しない');

// 明示 mid 指定は尊重
const explicit = s.createCard({ kind:'memo', content:'明示', mid:'手動', parentRefId: memo.ref.id });
assert.equal(s.getBody(explicit.body.id).mid, '手動', '明示midを尊重');

// 親メモが空 content → 継承しない
const emptyMemo = s.createCard({ kind:'memo', content:'', parentRefId: day.ref.id });
const underEmpty = s.createCard({ kind:'memo', content:'x', parentRefId: emptyMemo.ref.id });
assert.equal(s.getBody(underEmpty.body.id).mid, undefined, '親メモ空→継承しない');

// 作成後に親メモをリネームしても子の mid は不変（作成時スナップショット）
s.updateBody(memo.body.id, { content:'見積フェーズ(改)' });
assert.equal(s.getBody(child.body.id).mid, '見積フェーズ', '親リネーム後も子midは不変');

console.log('PASS store.midinherit');
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node tests/store.midinherit.test.mjs`
Expected: FAIL（child の mid が undefined＝継承していない）

- [ ] **Step 3: `createCard` に継承を実装**

`v2/src/store.js` の `createCard`（73行付近）を変更。

変更前:
```js
  function createCard({ parentRefId=null, order=null, collapsed, gridWk, ...bodyAttrs }){
    const body = createBody(bodyAttrs);
```

変更後:
```js
  function createCard({ parentRefId=null, order=null, collapsed, gridWk, ...bodyAttrs }){
    // 中項目の作成時継承: 明示 mid 指定が無く、親refのbodyがメモ(content非空)なら親メモ名をmidに（1回限り・以後追従しない）
    if (bodyAttrs.mid === undefined && parentRefId){
      const pref = S.refs[parentRefId];
      const pbody = pref && S.bodies[pref.bodyId];
      if (pbody && pbody.kind === 'memo' && (pbody.content || '').trim()){
        bodyAttrs.mid = pbody.content.trim();
      }
    }
    const body = createBody(bodyAttrs);
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node tests/store.midinherit.test.mjs`
Expected: `PASS store.midinherit`

- [ ] **Step 5: 全テストが緑のまま（デグレ無し）を確認**

Run: `for f in tests/*.test.mjs; do node "$f"; done`
Expected: すべて PASS（既存テストは body の mid 追加に非依存）

- [ ] **Step 6: コミット**

```bash
git add v2/src/store.js v2/tests/store.midinherit.test.mjs
git commit -m "feat(v2): inherit 中項目 from parent memo on card creation (#2)"
```

---

## Task 3: #4 リストからタスクを追加 — `addTaskToday` とロジック

**Files:**
- Modify: `v2/src/list.js`（`addTaskToday` を追加 export）
- Test: `v2/tests/list.addtask.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`v2/tests/list.addtask.test.mjs` を新規作成:

```js
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node tests/list.addtask.test.mjs`
Expected: FAIL（`addTaskToday` is not a function）

- [ ] **Step 3: `addTaskToday` を実装**

`v2/src/list.js` の `midsForProject`（Task 1で追加）の直後に追加:

```js
// 今日の day カード直下に task を作成（グループの proj/mid を継承）。today 省略時は当日。
export function addTaskToday(store, { proj, mid } = {}, today){
  const date = today || new Date().toISOString().slice(0, 10);
  const day = store.ensureDayCard(date);
  const attrs = { kind:'task', content:'', parentRefId: day.ref.id };
  if (proj) attrs.proj = proj;
  if (mid)  attrs.mid  = mid;   // 明示mid＝親がdayなので#2継承は発生せずこの値が入る
  return store.createCard(attrs);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node tests/list.addtask.test.mjs`
Expected: `PASS list.addtask`

- [ ] **Step 5: コミット**

```bash
git add v2/src/list.js v2/tests/list.addtask.test.mjs
git commit -m "feat(v2): addTaskToday helper for list-view task creation (#4 core)"
```

---

## Task 4: #4 リスト追加UI — 追加行/追加バーの結線

**Files:**
- Modify: `v2/src/list.js`（`renderList` の描画ループに追加行、`doAddTask` ヘルパ、`showToast` の import）
- Modify: `v2/style.css`（`.list-addrow`/`.list-add-btn`/`.list-addbar`）

- [ ] **Step 1: `showToast` を import**

`v2/src/list.js` 冒頭（7行目 `const { renderOutlinePage } = await import(...)` の直後）に追加:

```js
const { showToast } = await import('./clipboard.js' + _q);   // 追加後の非表示通知に使用
```

- [ ] **Step 2: `doAddTask` ヘルパを追加**

`v2/src/list.js` の `addTaskToday`（Task 3）の直後に追加:

```js
// 追加→再描画→新規タスクのタイトルへフォーカスして即編集。絞り込みで非表示ならトースト。
function doAddTask(store, requestRender, ctx, today){
  const { body } = addTaskToday(store, ctx, today);
  requestRender();
  const chip = document.querySelector('[data-fkey="title:' + body.id + '"]');
  if (chip){ chip.focus(); chip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }
  else showToast('タスクを追加しました（現在の絞り込みでは非表示）');
}
```

- [ ] **Step 3: 追加行を生成する `addRow` を追加**

`v2/src/list.js` の `midRow`（160行付近）の直後に追加:

```js
// グループ末尾の「＋ タスク追加」行（proj/mid を継承して今日の日付に作成）
function addRow(store, requestRender, proj, mid, span, today){
  const tr = document.createElement('tr'); tr.className = 'list-addrow';
  const td = document.createElement('td'); td.colSpan = span;
  const btn = document.createElement('span'); btn.className = 'list-add-btn'; btn.textContent = '＋ タスク追加';
  btn.onclick = () => doAddTask(store, requestRender, { proj: proj || undefined, mid: mid || undefined }, today);
  td.appendChild(btn); tr.appendChild(td); return tr;
}
```

- [ ] **Step 4: 描画ループに追加行を差し込む（grouped表示）**

`v2/src/list.js` の `renderList` 内、プロジェクト見出しと中項目見出しの生成箇所（226-238行付近）を変更。

変更前:
```js
      if (grouped && g !== curGroup){
        curGroup = g; curMid = undefined; skip = !!collapsed[g];
        tb.appendChild(groupRow(store, g, cols.length, counts[g], !!collapsed[g],
          () => { collapsed[g] = !collapsed[g]; requestRender(); }));
      }
      if (grouped && skip) continue;                 // プロジェクト折りたたみ中はタスク行を出さない
      if (grouped && projHasMid[g]){                 // 中項目の小見出し（中項目を使うPJのみ）
        const m = t.mid || '';
        if (m !== curMid){
          curMid = m; midSkip = midIsColl(midColl, g, m);
          tb.appendChild(midRow(g, m, cols.length, midSkip, () => { midSetColl(midColl, g, m, !midIsColl(midColl, g, m)); requestRender(); }));
        }
      } else { midSkip = false; }
```

変更後:
```js
      if (grouped && g !== curGroup){
        curGroup = g; curMid = undefined; skip = !!collapsed[g];
        tb.appendChild(groupRow(store, g, cols.length, counts[g], !!collapsed[g],
          () => { collapsed[g] = !collapsed[g]; requestRender(); }));
        if (!skip && !projHasMid[g]) tb.appendChild(addRow(store, requestRender, g, '', cols.length, today));  // 中項目なしPJ: 見出し直下に追加行
      }
      if (grouped && skip) continue;                 // プロジェクト折りたたみ中はタスク行を出さない
      if (grouped && projHasMid[g]){                 // 中項目の小見出し（中項目を使うPJのみ）
        const m = t.mid || '';
        if (m !== curMid){
          curMid = m; midSkip = midIsColl(midColl, g, m);
          tb.appendChild(midRow(g, m, cols.length, midSkip, () => { midSetColl(midColl, g, m, !midIsColl(midColl, g, m)); requestRender(); }));
          if (!midSkip) tb.appendChild(addRow(store, requestRender, g, m, cols.length, today));  // 中項目見出し直下に追加行
        }
      } else { midSkip = false; }
```

- [ ] **Step 5: 非grouped表示に単一の追加バーを差し込む**

`v2/src/list.js` の `renderList` で、テーブルを mount へ追加する直前（`mount.appendChild(table);` の直前・250行付近）に追加:

```js
  if (!grouped){                                     // ツリー以外の並べ替え: 上部に単一の追加バー（今日・PJ/中項目なし）
    const bar = document.createElement('div'); bar.className = 'list-addbar';
    const b = document.createElement('span'); b.className = 'list-add-btn'; b.textContent = '＋ タスク追加';
    b.onclick = () => doAddTask(store, requestRender, {}, today);
    bar.appendChild(b); mount.appendChild(bar);
  }
```

- [ ] **Step 6: スタイルを追加**

`v2/style.css` の末尾に追加:

```css
/* リストからのタスク追加（#4） */
.list-addrow > td { padding: 2px 0; }
.list-add-btn { display: inline-block; padding: 2px 8px; margin-left: 34px; font-size: 12px; color: #2563eb; cursor: pointer; border-radius: 4px; }
.list-add-btn:hover { background: #eff6ff; }
.list-addbar { padding: 4px 0 6px; }
.list-addbar .list-add-btn { margin-left: 4px; }
```

- [ ] **Step 7: 既存テストが緑のままを確認**

Run: `for f in tests/*.test.mjs; do node "$f"; done`
Expected: すべて PASS（UI変更のみ・純ロジック不変）

- [ ] **Step 8: 実機で追加を確認（ブラウザ）**

リストのPJツリー表示で中項目見出し直下の「＋タスク追加」→ 今日の日付にタスクが作られ、タイトルが編集状態でフォーカスされることを確認。デイリー側でも同カードが今日の日付に現れることを確認。

- [ ] **Step 9: コミット**

```bash
git add v2/src/list.js v2/style.css
git commit -m "feat(v2): +タスク追加 rows/bar in list view (#4 UI)"
```

---

## Task 5: #1 リストD&Dで中項目移動 — `canDropTask` ロジック

**Files:**
- Modify: `v2/src/list.js`（`canDropTask` を追加 export）
- Test: `v2/tests/list.dnd.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`v2/tests/list.dnd.test.mjs` を新規作成:

```js
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node tests/list.dnd.test.mjs`
Expected: FAIL（`canDropTask` is not a function）

- [ ] **Step 3: `canDropTask` を実装**

`v2/src/list.js` の `addTaskToday`（Task 3）の直後に追加:

```js
// D&Dで中項目を移動できる先か: 同一PJ内のみ許可（proj は変えない＝#1確定仕様）
export function canDropTask(store, taskId, targetProj){
  const b = store.getBody(taskId);
  if (!b) return false;
  return (b.proj || '') === (targetProj || '');
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node tests/list.dnd.test.mjs`
Expected: `PASS list.dnd`

- [ ] **Step 5: コミット**

```bash
git add v2/src/list.js v2/tests/list.dnd.test.mjs
git commit -m "feat(v2): canDropTask guard for same-project 中項目 move (#1 core)"
```

---

## Task 6: #1 D&D結線（ドラッグ可能化・ドロップ処理・ハイライト）

**Files:**
- Modify: `v2/src/list.js`（`renderList` の task 行を draggable 化＋tbody にドロップ委譲、module変数 `_dragTask`/`_dropHiEl` とヘルパ）
- Modify: `v2/style.css`（`.drop-hi`）

- [ ] **Step 1: module変数とヘルパを追加**

`v2/src/list.js` の `let _listCtx = null;`（11行付近）の直後に追加:

```js
let _dragTask = null;   // D&D中のタスク {id, proj}
let _dropHiEl = null;   // ドロップ候補のハイライト行
function clearDropHi(){ if (_dropHiEl){ _dropHiEl.classList.remove('drop-hi'); _dropHiEl = null; } }
function hiRow(tr){ if (_dropHiEl !== tr){ clearDropHi(); if (tr){ tr.classList.add('drop-hi'); _dropHiEl = tr; } } }
// ドロップ先の行から所属PJ・中項目を判定（中項目見出し / PJ見出し(中項目なしPJ) / タスク行）。対象外は null。
function dropInfo(tr){
  if (!tr) return null;
  if (tr.dataset && tr.dataset.task) return { proj: tr.dataset.proj || '', mid: tr.dataset.mid || '' };
  const head = tr.querySelector && tr.querySelector('td.nav-head');
  if (head){
    if ('mid' in head.dataset) return { proj: head.dataset.proj || '', mid: head.dataset.mid || '' };  // 中項目見出し
    return { proj: head.dataset.proj || '', mid: '' };                                                 // PJ見出し(中項目なしPJ)
  }
  return null;
}
```

- [ ] **Step 2: task 行を draggable にする**

`v2/src/list.js` の `renderList` 内、task の `tr` 生成箇所（240-246行付近）を変更。

変更前:
```js
      const tr = document.createElement('tr');
      tr.dataset.task = t.id; tr.dataset.proj = g; tr.dataset.mid = t.mid || '';
      if (t.done) tr.classList.add('row-done');
      if (state._sel && state._sel.has(t.id)) tr.classList.add('row-sel');   // 行選択中のハイライト
      for (const k of cols) tr.appendChild(COLUMNS[k].render(store, requestRender, t));
      if (grouped && tr.firstChild) tr.firstChild.style.paddingLeft = (projHasMid[g] ? 34 : 18) + 'px';   // ツリーのインデント
      tb.appendChild(tr);
```

変更後:
```js
      const tr = document.createElement('tr');
      tr.dataset.task = t.id; tr.dataset.proj = g; tr.dataset.mid = t.mid || '';
      if (t.done) tr.classList.add('row-done');
      if (state._sel && state._sel.has(t.id)) tr.classList.add('row-sel');   // 行選択中のハイライト
      for (const k of cols) tr.appendChild(COLUMNS[k].render(store, requestRender, t));
      if (grouped && tr.firstChild) tr.firstChild.style.paddingLeft = (projHasMid[g] ? 34 : 18) + 'px';   // ツリーのインデント
      if (grouped){                                    // D&Dで中項目移動（同PJ内のみ）
        tr.draggable = true;
        tr.addEventListener('dragstart', (e) => { _dragTask = { id: t.id, proj: g }; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', t.id); } catch(_){} });
        tr.addEventListener('dragend', () => { _dragTask = null; clearDropHi(); });
      }
      tb.appendChild(tr);
```

- [ ] **Step 3: tbody にドロップ委譲を追加**

`v2/src/list.js` の `renderList` 内、`table.appendChild(tb);`（249行付近）の直前に追加:

```js
    tb.addEventListener('dragover', (e) => {
      if (!_dragTask) return;
      const info = dropInfo(e.target.closest && e.target.closest('tr'));
      if (info && canDropTask(store, _dragTask.id, info.proj)){ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; hiRow(e.target.closest('tr')); }
      else { clearDropHi(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; }
    });
    tb.addEventListener('drop', (e) => {
      if (!_dragTask) return;
      const info = dropInfo(e.target.closest && e.target.closest('tr'));
      if (info && canDropTask(store, _dragTask.id, info.proj)){
        e.preventDefault();
        const newMid = info.mid || undefined;
        if ((store.getBody(_dragTask.id).mid || '') !== (newMid || '')){ store.updateBody(_dragTask.id, { mid: newMid }); requestRender(); }
      }
      clearDropHi();
    });
```

- [ ] **Step 4: ハイライトのスタイルを追加**

`v2/style.css` の末尾（Task 4 のブロックの後）に追加:

```css
/* D&Dで中項目移動（#1） */
.list-table tr.drop-hi > * { box-shadow: inset 0 -2px 0 #2563eb; background: #eff6ff; }
```

- [ ] **Step 5: 全テストが緑のままを確認**

Run: `for f in tests/*.test.mjs; do node "$f"; done`
Expected: すべて PASS

- [ ] **Step 6: 実機でD&Dを確認（ブラウザ）**

PJツリー表示で、あるタスク行を同一PJ内の別中項目見出し（または別中項目のタスク行）へドラッグ→ドロップし、`mid` が変わることを確認。別PJのグループ上ではドロップ不可（カーソルが `not-allowed`・ハイライトなし）を確認。「（中項目なし）」見出しへドロップで mid がクリアされることを確認。

- [ ] **Step 7: コミット**

```bash
git add v2/src/list.js v2/style.css
git commit -m "feat(v2): drag task between 中項目 within a project in list (#1 UI)"
```

---

## Task 7: #3 リンク保持コピー — シリアライズ拡張とメンション解決

**Files:**
- Modify: `v2/src/clipboard.js`（`serializeSubtree`/`encodeClipHtml`/`insertNodes`＋`resolveMentions`/`nodesToTree`/`renderItems`/`escAttr`）
- Test: `v2/tests/clipboard.copy.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`v2/tests/clipboard.copy.test.mjs` を新規作成:

```js
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { serializeSubtree, encodeClipHtml, decodeClipHtml, insertNodes } from '../src/clipboard.js';

const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-07-03' });
// リンク付きカード＋子。子はメンション（@リンク先=リンク付きカード）を含む
const A = s.createCard({ kind:'memo', content:'A見出し', parentRefId: day.ref.id });
s.updateBody(A.body.id, { url:'https://example.com/a' });
const B = s.createCard({ kind:'memo', content:'前 ⟦' + A.body.id + '⟧ 後', parentRefId: A.ref.id });

const { nodes, plain } = serializeSubtree(s, A.ref.id);

// url が node に含まれる
assert.equal(nodes[0].url, 'https://example.com/a', 'url をシリアライズ');
// メンションは表示名に解決（plain / text）
assert.ok(nodes[1].text.includes('@A見出し'), 'メンションを表示名に解決(text)');
assert.ok(!nodes[1].text.includes('⟦'), '生マーカーは残らない(text)');
assert.ok(plain.includes('@A見出し') && !plain.includes('⟦'), 'plainもメンション解決');
// content(生)はJSON往復用に保持
assert.ok(nodes[1].content.includes('⟦' + A.body.id + '⟧'), 'contentは生マーカー保持');

// HTML: <a href> と入れ子 <ul>、マーカーを保持
const html = encodeClipHtml(nodes, plain);
assert.ok(html.includes('<a href="https://example.com/a">'), 'url→<a href>');
assert.ok(html.includes('<ul>') && html.includes('<li>'), '入れ子リスト');
assert.ok(html.includes('data-pwt2-clip='), 'マーカー保持（アプリ内往復）');
assert.ok(html.includes('@A見出し'), 'HTMLもメンション解決');

// 往復: decode→insert で url が保持される
const s2 = createStore();
const d2 = s2.createCard({ kind:'day', content:'d' });
const X = s2.createCard({ kind:'memo', content:'X', parentRefId: d2.ref.id });
insertNodes(s2, X.ref.id, decodeClipHtml(html));
const ARef = s2.childRefs(d2.ref.id).find(r => s2.getBody(r.bodyId).content === 'A見出し');
assert.ok(ARef, 'A見出しが復元');
assert.equal(s2.getBody(ARef.bodyId).url, 'https://example.com/a', 'url が往復で保持');

console.log('PASS clipboard.copy');
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node tests/clipboard.copy.test.mjs`
Expected: FAIL（`nodes[0].url` が undefined 等）

- [ ] **Step 3: `resolveMentions` とHTML生成ヘルパを追加**

`v2/src/clipboard.js` の `escHtml` 定義（9行付近）の直後に追加:

```js
const escAttr = (s) => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const MENTION_RE = /⟦([^⟧]+)⟧/g;
// ⟦id⟧ を「@表示名」に解決（day は日付・その他は content 先頭24字・不明は @?）
function resolveMentions(store, content){
  return String(content || '').replace(MENTION_RE, (_, id) => {
    const b = store.getBody(id);
    if (!b) return '@?';
    return '@' + (b.kind === 'day' ? b.content : (b.content || '無題').slice(0, 24));
  });
}
// フラットな depth 列を木に組み直す
function nodesToTree(nodes){
  const roots = [], stack = [];
  for (const n of nodes){
    const item = { node: n, children: [] };
    const d = Math.max(0, n.depth | 0);
    if (d === 0 || !stack[d - 1]) roots.push(item); else stack[d - 1].children.push(item);
    stack[d] = item; stack.length = d + 1;
  }
  return roots;
}
// 木を入れ子 <ul><li> に（url は <a href> 化）
function renderItems(items){
  let out = '<ul>';
  for (const it of items){
    const n = it.node, t = escHtml(n.text != null ? n.text : (n.content || ''));
    const label = n.url ? `<a href="${escAttr(n.url)}">${t}</a>` : t;
    out += '<li>' + label + (it.children.length ? renderItems(it.children) : '') + '</li>';
  }
  return out + '</ul>';
}
```

- [ ] **Step 4: `serializeSubtree` を url/mid/書式＋メンション解決に対応**

`v2/src/clipboard.js` の `serializeSubtree`（12-23行付近）を変更。

変更前:
```js
export function serializeSubtree(store, rootRefId){
  const nodes = [];
  const collect = (refId, depth) => {
    const ref = store.getRef(refId); if (!ref) return;
    const b = store.getBody(ref.bodyId); if (!b) return;
    nodes.push({ content:b.content||'', kind:b.kind||'memo', done:!!b.done, prio:b.prio||0, due:b.due||'', proj:b.proj||'', depth });
    for (const c of store.childRefs(refId)) collect(c.id, depth + 1);
  };
  collect(rootRefId, 0);
  const plain = nodes.map(n => '\t'.repeat(n.depth) + n.content).join('\n');
  return { nodes, plain };
}
```

変更後:
```js
export function serializeSubtree(store, rootRefId){
  const nodes = [];
  const collect = (refId, depth) => {
    const ref = store.getRef(refId); if (!ref) return;
    const b = store.getBody(ref.bodyId); if (!b) return;
    const node = { content:b.content||'', text: resolveMentions(store, b.content||''),
      kind:b.kind||'memo', done:!!b.done, prio:b.prio||0, due:b.due||'', proj:b.proj||'', depth };
    if (b.url)   node.url   = b.url;      // リンク保持（メール/アプリ内往復）
    if (b.mid)   node.mid   = b.mid;
    if (b.bold)  node.bold  = true;
    if (b.color) node.color = b.color;
    nodes.push(node);
    for (const c of store.childRefs(refId)) collect(c.id, depth + 1);
  };
  collect(rootRefId, 0);
  const plain = nodes.map(n => '\t'.repeat(n.depth) + (n.text != null ? n.text : n.content)).join('\n');
  return { nodes, plain };
}
```

- [ ] **Step 5: `encodeClipHtml` を入れ子リスト＋リンクに刷新**

`v2/src/clipboard.js` の `encodeClipHtml`（25-28行付近）を変更。

変更前:
```js
export function encodeClipHtml(nodes, plain){
  const b64 = b64enc(JSON.stringify(nodes));
  return `<div data-pwt2-clip="${b64}">${escHtml(plain).replace(/\n/g,'<br>')}</div>`;
}
```

変更後:
```js
export function encodeClipHtml(nodes, plain){
  const b64 = b64enc(JSON.stringify(nodes));                 // マーカー=アプリ内の完全復元用（生content含む）
  const body = nodes && nodes.length ? renderItems(nodesToTree(nodes))   // メール等=リンク/階層を保った入れ子リスト
                                     : escHtml(plain || '').replace(/\n/g, '<br>');
  return `<div data-pwt2-clip="${b64}">${body}</div>`;
}
```

- [ ] **Step 6: `insertNodes` で url/書式/mid を反映**

`v2/src/clipboard.js` の `insertNodes` 内、属性組み立て（129-133行付近）を変更。

変更前:
```js
    const attrs = { kind: n.kind || 'memo', content: n.content || '', parentRefId, order };
    if (n.done) attrs.done = true;
    if (n.prio) attrs.prio = n.prio;
    if (n.due)  attrs.due  = n.due;
    if (n.proj) attrs.proj = n.proj;
```

変更後:
```js
    const attrs = { kind: n.kind || 'memo', content: n.content || '', parentRefId, order };
    if (n.done)  attrs.done  = true;
    if (n.prio)  attrs.prio  = n.prio;
    if (n.due)   attrs.due   = n.due;
    if (n.proj)  attrs.proj  = n.proj;
    if (n.url)   attrs.url   = n.url;     // リンク保持
    if (n.mid)   attrs.mid   = n.mid;     // 明示mid（#2継承より優先）
    if (n.bold)  attrs.bold  = true;
    if (n.color) attrs.color = n.color;
```

- [ ] **Step 7: 新テストが通ることを確認**

Run: `node tests/clipboard.copy.test.mjs`
Expected: `PASS clipboard.copy`

- [ ] **Step 8: 既存 clipboard テストと全テストが緑のままを確認**

Run: `for f in tests/*.test.mjs; do node "$f"; done`
Expected: すべて PASS（既存 `clipboard.test.mjs` は content/depth/kind等のみ検証＝`text`/`url` 追加に非依存・`decodeClipHtml` 往復も維持）

- [ ] **Step 9: 実機でメール貼付を確認（ブラウザ）**

リンクを含むカード＋子ツリーをカーソル選択（文字選択でない状態）で Ctrl+C →実際のメール（Outlook等）へ貼り付け、リンクがクリック可能・階層（箇条書き）が保たれることを確認。アプリ内の別カードへ Ctrl+V で貼り付け、リンクが保持されることも確認。

- [ ] **Step 10: コミット**

```bash
git add v2/src/clipboard.js v2/tests/clipboard.copy.test.mjs
git commit -m "feat(v2): link-preserving copy (nested list + <a>, mention resolve) (#3)"
```

---

## Task 8: CHANGELOG 更新と最終確認

**Files:**
- Modify: `v2/CHANGELOG.md`

- [ ] **Step 1: CHANGELOG に追記**

`v2/CHANGELOG.md` の先頭（`# Tracker v2 — CHANGELOG` の直後）に、5機能をまとめたエントリを新バージョン（例 `v0.56.0`）として追記。各項目に「何を・どこを変えたか・検証方法」を1〜2行で記載（既存エントリの粒度に合わせる）。仕様書 `docs/superpowers/specs/2026-07-03-tracker-v2-five-features.md` を参照として明記。

- [ ] **Step 2: 全テスト緑を最終確認**

Run: `for f in tests/*.test.mjs; do node "$f"; done`
Expected: 既存15＋新規5＝全20件 PASS

- [ ] **Step 3: コミット**

```bash
git add v2/CHANGELOG.md
git commit -m "docs(v2): changelog for five features (#5/#2/#4/#1/#3)"
```

---

## Self-Review 結果

- **Spec coverage**: #5→Task1、#2→Task2、#4→Task3(ロジック)+Task4(UI)、#1→Task5(ロジック)+Task6(UI)、#3→Task7。#6は仕様どおり対象外。全要件にタスク対応あり。
- **Placeholder scan**: TBD/TODO等なし。全コードステップに実コードを記載。
- **Type consistency**: `midsForProject(store, projId)`/`addTaskToday(store,{proj,mid},today)`/`canDropTask(store,taskId,targetProj)`/`doAddTask`/`addRow`/`dropInfo`/`resolveMentions`/`nodesToTree`/`renderItems`/`escAttr` の名称・引数は全タスクで一貫。`serializeSubtree` のノードに追加する `text`/`url`/`mid`/`bold`/`color` は `insertNodes` 側の反映と整合。
- **デグレ確認**: 既存テストは body の新フィールド(`mid`)や node の新フィールド(`text`/`url`)に非依存であることを確認済み（body全体 deepEqual テストは存在しない）。各UIタスク後に全テスト再実行を明記。
