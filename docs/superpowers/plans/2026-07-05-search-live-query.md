# 検索/ライブクエリ機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全カード（memo/task）を横断して キーワード/タグ/PJ/期限(今日基準)/完了/優先度 の AND 条件で検索し、編集可能ミラーでライブ表示、名前付き保存＆保存検索へのリンクまで行う「検索」ビューを追加する。

**Architecture:** クエリ判定は純関数（`search.js` の `matchCard`/`runQuery`）に隔離＝軽量・単体テスト可能。結果描画は既存 `renderChildren(..., {refs, mirrorRoot})` を流用。保存は既存 `store.saveView` に `kind:'search'` を付与。保存検索リンクは `⟦s:id⟧` マーカー（`@`メンション機構の拡張）。ツールバーに「🔍 検索」ビューを追加。

**Tech Stack:** Vanilla ES modules（ビルド無し）。テストは `node tests/<name>.test.mjs`（作業ディレクトリ `v2/`・自己実行スクリプト・`PASS <name>` を出力）。

---

## 前提・共通事項（実装者向け）

- 作業ディレクトリ: リポジトリルート `C:/Users/13122180/AG2/WeeklyReports/Weekly`。テストは `v2/` から `node tests/<name>.test.mjs`。全テスト確認は `for f in tests/*.test.mjs; do node "$f"; done`（すべて PASS）。
- コミットはリポジトリルートで `git add v2/...`。コミットメッセージ末尾に空行＋`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 各フェーズ完了で `v2/src/app.js` の `APP_VERSION` を上げ、`v2/CHANGELOG.md` に追記、main へマージ、Pages で確認（この計画では実装＋単体まで記述。デプロイ手順は運用側）。
- データ: `body` = { `kind`(memo/task/day/project/table/image), `content`(本文・`#タグ`/`⟦id⟧`含む), `proj`, `mid`, `due`, `prio`, `done`/`doneAt` }。`store.queryBodies(pred)`, `store.getRef`, `store.refsForBody`, `store.childRefs`。
- 既存の純関数を再利用: `list.js` の `dueGroupMatch(due, cond, today)` と `projMatch(proj, filter)` を **export 追加**して `search.js` から import（DRY・単一実装）。
- 既存ミラー描画: `daily.js` の `export function renderChildren(store, parentRefId, mountEl, depth, requestRender, opts)`。`opts = { refs:[ref,...], mirrorRoot:true }` で指定 ref 群を編集可能ミラー描画（`project.js` の割当カードと同型）。

---

## File Structure

- `v2/src/search.js` — **新規**。純ロジック（`cardTags`/`matchCard`/`runQuery`）＋ `renderSearchView`（クエリビルダ＋結果ミラー）＋（P2）保存検索UI＋（P3）`openSavedSearch` 連携。
- `v2/src/list.js` — `dueGroupMatch`/`projMatch` を export（変更は export 追加のみ）。
- `v2/src/app.js` — 'search' ビューの配線（ツールバーボタン・`currentView`・`renderAll`・ナビ履歴・searchState）＋（P3）`openSavedSearch`。
- `v2/src/daily.js` — （P3）`@`ポップアップに保存検索を追加、`fillEditable`/`makeChip` を `⟦s:id⟧` 対応、`setSavedSearchOpener`。
- `v2/index.html` — `#view-search` コンテナ＋ツールバー「🔍 検索」ボタン。
- `v2/style.css` — 検索ビューのUI（`.search-*`）。
- `v2/tests/search.match.test.mjs` / `v2/tests/search.query.test.mjs` — 新規テスト。

---

# Phase 1: クエリ基盤＋検索ビュー

## Task 1: list.js の純マッチャを export（再利用の下地）

**Files:** Modify `v2/src/list.js`

- [ ] **Step 1: `dueGroupMatch` と `projMatch` に export を付ける**

`v2/src/list.js` で以下2つの宣言に `export` を付与（本体は変更しない）。

変更前:
```js
function dueGroupMatch(due, cond, today){
```
変更後:
```js
export function dueGroupMatch(due, cond, today){
```

変更前:
```js
function projMatch(proj, filter){
```
変更後:
```js
export function projMatch(proj, filter){
```

- [ ] **Step 2: 既存テストが緑のまま**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f"; done`
Expected: すべて PASS（export 追加のみ・挙動不変）

- [ ] **Step 3: コミット**

```
git add v2/src/list.js
git commit -m "refactor(v2): export dueGroupMatch/projMatch for reuse by search"
```

## Task 2: 純ロジック `cardTags` / `matchCard`

**Files:** Create `v2/src/search.js`, Test `v2/tests/search.match.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`v2/tests/search.match.test.mjs`:
```js
import assert from 'node:assert/strict';
import { cardTags, matchCard } from '../src/search.js';

const today = '2026-07-05';
const b = (o) => Object.assign({ kind:'task', content:'', proj:undefined, due:'', prio:0, done:false }, o);

// cardTags
assert.deepEqual([...cardTags('資料 #設計 と #実装')].sort(), ['実装','設計']);
assert.deepEqual([...cardTags('タグなし')], []);

// kind: memo/task のみ対象
assert.equal(matchCard(b({ kind:'day', content:'x' }), {}, today), false, 'day は対象外');
assert.equal(matchCard(b({ kind:'project', content:'x' }), {}, today), false, 'project は対象外');
assert.equal(matchCard(b({ kind:'memo', content:'x' }), {}, today), true, 'memo は対象');

// keyword
assert.equal(matchCard(b({ content:'週次レビュー' }), { keyword:'レビュー' }, today), true);
assert.equal(matchCard(b({ content:'週次レビュー' }), { keyword:'zzz' }, today), false);
assert.equal(matchCard(b({ content:'ABC' }), { keyword:'abc' }, today), true, 'ケース無視');

// tags（全て含む AND）
assert.equal(matchCard(b({ content:'x #設計 #実装' }), { tags:['設計'] }, today), true);
assert.equal(matchCard(b({ content:'x #設計 #実装' }), { tags:['設計','実装'] }, today), true);
assert.equal(matchCard(b({ content:'x #設計' }), { tags:['設計','実装'] }, today), false, '一部欠けは非該当');

// proj
assert.equal(matchCard(b({ proj:'p1' }), { proj:'p1' }, today), true);
assert.equal(matchCard(b({ proj:'p1' }), { proj:'p2' }, today), false);
assert.equal(matchCard(b({ proj:undefined }), { proj:'none' }, today), true);
assert.equal(matchCard(b({ proj:'p1' }), { proj:'all' }, today), true);

// due（今日基準）
assert.equal(matchCard(b({ due:'2026-07-01' }), { due:{mode:'range',to:-1} }, today), true, '期限切れ');
assert.equal(matchCard(b({ due:'2026-07-05' }), { due:{mode:'range',from:0,to:0} }, today), true, '今日');
assert.equal(matchCard(b({ due:'' }), { due:{mode:'none'} }, today), true, '期限なし');
assert.equal(matchCard(b({ due:'2026-07-20' }), { due:{mode:'range',from:0,to:7} }, today), false, '今後7日外');

// done（memo は notDone 扱い）
assert.equal(matchCard(b({ kind:'task', done:true }), { done:{mode:'done'} }, today), true);
assert.equal(matchCard(b({ kind:'task', done:false }), { done:{mode:'done'} }, today), false);
assert.equal(matchCard(b({ kind:'memo' }), { done:{mode:'notDone'} }, today), true);
assert.equal(matchCard(b({ kind:'memo' }), { done:{mode:'done'} }, today), false);

// prio
assert.equal(matchCard(b({ prio:3 }), { prio:'3' }, today), true);
assert.equal(matchCard(b({ prio:1 }), { prio:'3' }, today), false);

// 複合 AND
assert.equal(matchCard(b({ content:'見積 #設計', proj:'p1', due:'2026-07-05', prio:2 }),
  { keyword:'見積', tags:['設計'], proj:'p1', due:{mode:'range',from:0,to:0}, prio:'2' }, today), true);

console.log('PASS search.match');
```

- [ ] **Step 2: 失敗確認**

Run: `cd v2 && node tests/search.match.test.mjs`
Expected: FAIL（search.js が無い）

- [ ] **Step 3: `search.js` を実装（純ロジックのみ）**

`v2/src/search.js`（新規）:
```js
// 検索/ライブクエリ: 純ロジック（テスト対象）＋ 検索ビュー描画。
const _q = new URL(import.meta.url).search;
const { dueGroupMatch, projMatch } = await import('./list.js' + _q);
const { renderChildren } = await import('./daily.js' + _q);

const TAG_RE = /#([^\s#⟦⟧]+)/g;
// 本文中の #タグ 名の集合
export function cardTags(content){
  const set = new Set(); let m; TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(content || ''))) set.add(m[1]);
  return set;
}
// カードが query に AND で一致するか。対象は memo/task のみ。
export function matchCard(body, query, today){
  if (!body || (body.kind !== 'memo' && body.kind !== 'task')) return false;
  const q = query || {};
  if (q.keyword){ if (!(body.content || '').toLowerCase().includes(q.keyword.toLowerCase())) return false; }
  if (q.tags && q.tags.length){ const tags = cardTags(body.content); for (const t of q.tags) if (!tags.has(t)) return false; }
  if (q.proj && q.proj !== 'all'){ if (!projMatch(body.proj, q.proj)) return false; }
  if (q.due && q.due.mode && q.due.mode !== 'any'){ if (!dueGroupMatch(body.due, q.due, today)) return false; }
  if (q.done && q.done.mode === 'done'  && !body.done) return false;
  if (q.done && q.done.mode === 'notDone' && body.done) return false;
  if (q.prio && q.prio !== 'all'){ if (String(body.prio || 0) !== q.prio) return false; }
  return true;
}
```

- [ ] **Step 4: 通過確認**

Run: `cd v2 && node tests/search.match.test.mjs`
Expected: `PASS search.match`

- [ ] **Step 5: 全テスト緑**

Run: `cd v2 && for f in tests/*.test.mjs; do node "$f"; done`
Expected: すべて PASS

- [ ] **Step 6: コミット**

```
git add v2/src/search.js v2/tests/search.match.test.mjs
git commit -m "feat(v2): search query matcher (cardTags/matchCard) with AND conditions"
```

## Task 3: `runQuery`（一致カードの最上位だけを返す）

**Files:** Modify `v2/src/search.js`, Test `v2/tests/search.query.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`v2/tests/search.query.test.mjs`:
```js
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { runQuery } from '../src/search.js';

const today = '2026-07-05';
const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-07-05' });
// 親 #設計 > 子 #設計（両方一致）→ 親だけ返す（重複除外）
const parent = s.createCard({ kind:'memo', content:'親 #設計', parentRefId: day.ref.id });
s.createCard({ kind:'memo', content:'子 #設計', parentRefId: parent.ref.id });
// 別の一致（独立）
s.createCard({ kind:'task', content:'単体 #設計', parentRefId: day.ref.id });
// 非該当
s.createCard({ kind:'memo', content:'無関係', parentRefId: day.ref.id });

const roots = runQuery(s, { tags:['設計'] }, today);
const contents = roots.map(r => r.body.content).sort();
assert.deepEqual(contents, ['単体 #設計','親 #設計'], '親配下の一致は親だけ・独立一致は別で計2件');
assert.ok(roots.every(r => r.ref && r.body), '各要素は {ref, body}');

// 条件に一致しなければ空
assert.deepEqual(runQuery(s, { keyword:'該当なしzz' }, today), []);

console.log('PASS search.query');
```

- [ ] **Step 2: 失敗確認**

Run: `cd v2 && node tests/search.query.test.mjs`
Expected: FAIL（runQuery 未定義）

- [ ] **Step 3: `runQuery` を実装（search.js に追記）**

`v2/src/search.js` の `matchCard` の後に追加:
```js
// 一致カードのうち「祖先も一致するもの」は除外し、最上位の一致だけを {ref, body} で返す（ミラー重複除外）。
export function runQuery(store, query, today){
  const matched = store.queryBodies(b => matchCard(b, query, today));
  const ids = new Set(matched.map(b => b.id));
  const out = [];
  for (const b of matched){
    const ref = store.refsForBody(b.id)[0];
    if (!ref) continue;
    let p = ref.parentRefId, skip = false;
    while (p){ const pr = store.getRef(p); if (!pr) break; if (ids.has(pr.bodyId)){ skip = true; break; } p = pr.parentRefId; }
    if (!skip) out.push({ ref, body: b });
  }
  return out;
}
// 出所の日付（親をたどって最初の day）。無ければ null。
export function sourceDay(store, refId){
  let p = refId; while (p){ const r = store.getRef(p); if (!r) break; const b = store.getBody(r.bodyId); if (b && b.kind === 'day') return b.content; p = r.parentRefId; }
  return null;
}
```

- [ ] **Step 4: 通過確認**

Run: `cd v2 && node tests/search.query.test.mjs`
Expected: `PASS search.query`

- [ ] **Step 5: 全テスト緑＋コミット**

```
cd v2 && for f in tests/*.test.mjs; do node "$f"; done   # すべて PASS
git add v2/src/search.js v2/tests/search.query.test.mjs
git commit -m "feat(v2): runQuery returns top-most matching cards (dedup descendants)"
```

## Task 4: 検索ビューのコンテナとツールバー（app.js/index.html）

**Files:** Modify `v2/index.html`, `v2/src/app.js`, `v2/style.css`

- [ ] **Step 1: index.html に検索コンテナとボタンを追加**

`v2/index.html` の `#app` 内に `#view-search` を追加:
```html
    <div id="view-project" hidden></div>
    <div id="view-search" hidden></div>
  </div>
```
ツールバーの分割ボタンの前に検索ボタンを追加:
```html
    <button class="btn" id="view-proj-btn">プロジェクト</button>
    <button class="btn" id="view-search-btn">🔍 検索</button>
    <button class="btn" id="view-split-btn" title="リストとデイリーを左右に分割">⊟ 分割</button>
```

- [ ] **Step 2: app.js に search ビューを配線**

`v2/src/app.js` 冒頭付近の import に search を追加（他の `await import` の並びに）:
```js
const { renderSearchView } = await import('./search.js' + _q);
```
`listState` 等の近くに検索状態を追加:
```js
const searchState = { query: { keyword:'', tags:[], proj:'all', due:{mode:'any'}, done:{mode:'any'}, prio:'all' } };
```
`renderAll` の非分割分岐（`if (currentView === 'project' ...)` の直後）に追加:
```js
    const sv = document.getElementById('view-search');
    if (sv) sv.hidden = currentView !== 'search';
    if (currentView === 'search' && sv) renderSearchView(store, sv, renderAll, searchState, jumpToCard);
```
※分割分岐でも `sv.hidden = true` を明示（検索は単独ビュー）。分割分岐の末尾に `const sv=document.getElementById('view-search'); if(sv) sv.hidden=true;` を追加。
`renderAll` 末尾のビューボタン active 切替に追加:
```js
  document.getElementById('view-search-btn')?.classList.toggle('active', currentView === 'search');
```
init（`document.getElementById('view-proj-btn')?.addEventListener(...)` の並び）にボタン配線:
```js
  document.getElementById('view-search-btn')?.addEventListener('click', () => selectView('search'));
```
`focusActiveViewFirst`（フォーカス安全網）の id 判定に search を含める:
変更前:
```js
  const id = currentView === 'list' ? 'view-list' : (currentView === 'project' ? 'view-project' : 'view-daily');
```
変更後:
```js
  const id = currentView === 'list' ? 'view-list' : currentView === 'project' ? 'view-project' : currentView === 'search' ? 'view-search' : 'view-daily';
```

- [ ] **Step 3: 最小の renderSearchView（まず「検索ビューです」＋結果件数のみ）を実装**

`v2/src/search.js` に追加（この Step では結果を件数表示のみ・次Taskでビルダとミラー）:
```js
export function renderSearchView(store, mount, requestRender, state, onJump){
  mount.innerHTML = '';
  const today = new Date().toISOString().slice(0, 10);
  const roots = runQuery(store, state.query, today);
  const head = document.createElement('div'); head.className = 'search-head'; head.textContent = '🔍 検索';
  const cnt = document.createElement('div'); cnt.className = 'search-count'; cnt.textContent = roots.length + ' 件';
  mount.appendChild(head); mount.appendChild(cnt);
}
```

- [ ] **Step 4: パース確認＋全テスト緑**

Run: `cd v2 && node -e "import('./src/search.js').then(()=>console.log('search.js OK'))"` → `search.js OK`
Run: `cd v2 && for f in tests/*.test.mjs; do node "$f"; done` → すべて PASS

- [ ] **Step 5: 実機確認（ブラウザ）**

「🔍 検索」ボタンでビュー切替・件数表示。ボタンの active 切替とフォーカス維持を確認。

- [ ] **Step 6: コミット**

```
git add v2/index.html v2/src/app.js v2/src/search.js
git commit -m "feat(v2): add search view scaffold (toolbar button + container + count)"
```

## Task 5: クエリビルダUI（AND条件）＋ミラー結果

**Files:** Modify `v2/src/search.js`, `v2/style.css`

- [ ] **Step 1: `renderSearchView` をビルダ＋ミラー結果に拡張**

`v2/src/search.js` の `renderSearchView` を置き換え:
```js
export function renderSearchView(store, mount, requestRender, state, onJump){
  mount.innerHTML = '';
  const today = new Date().toISOString().slice(0, 10);
  const q = state.query;

  const bar = document.createElement('div'); bar.className = 'search-bar';
  // キーワード
  const kw = document.createElement('input'); kw.type = 'text'; kw.className = 'search-kw'; kw.placeholder = 'キーワード'; kw.value = q.keyword || '';
  kw.addEventListener('input', () => { q.keyword = kw.value; state._refocus = 'kw'; requestRender(); });
  bar.appendChild(labelWrap('語', kw));
  // タグ（スペース/カンマ区切りで複数＝AND）
  const tg = document.createElement('input'); tg.type = 'text'; tg.className = 'search-tags'; tg.placeholder = '#無しでスペース区切り'; tg.value = (q.tags || []).join(' ');
  tg.addEventListener('input', () => { q.tags = tg.value.split(/[\s,]+/).map(s => s.replace(/^#/, '')).filter(Boolean); state._refocus = 'tg'; requestRender(); });
  bar.appendChild(labelWrap('タグ', tg));
  // プロジェクト
  const projOpts = [['all', 'すべて'], ['none', '未割当'], ...store.listProjects().map(p => [p.id, p.content || '(無題)'])];
  bar.appendChild(labelWrap('PJ', selectEl(projOpts, q.proj || 'all', v => { q.proj = v; requestRender(); })));
  // 期限（今日基準プリセット）
  bar.appendChild(labelWrap('期限', selectEl([
    ['any','すべて'], ['overdue','期限切れ'], ['today','今日'], ['soon','今後7日'], ['none','期限なし'],
  ], duePreset(q.due), v => { q.due = presetToDue(v); requestRender(); })));
  // 完了
  bar.appendChild(labelWrap('完了', selectEl([['any','すべて'], ['notDone','未完了'], ['done','完了']], (q.done && q.done.mode) || 'any', v => { q.done = { mode: v }; requestRender(); })));
  // 優先度
  bar.appendChild(labelWrap('優先度', selectEl([['all','すべて'], ['3','高'], ['2','中'], ['1','低'], ['0','なし']], q.prio || 'all', v => { q.prio = v; requestRender(); })));
  mount.appendChild(bar);

  const roots = runQuery(store, q, today);
  const cnt = document.createElement('div'); cnt.className = 'search-count'; cnt.textContent = roots.length + ' 件';
  mount.appendChild(cnt);

  if (!roots.length){
    const e = document.createElement('p'); e.className = 'search-empty'; e.textContent = '条件に一致するカードがありません。';
    mount.appendChild(e);
  } else {
    // 出所日付でグループ化（新しい日が上）
    const byDay = {};
    for (const r of roots){ const d = sourceDay(store, r.ref.id) || 'その他'; (byDay[d] = byDay[d] || []).push(r); }
    Object.keys(byDay).sort((a, b) => a === 'その他' ? 1 : b === 'その他' ? -1 : (a < b ? 1 : -1)).forEach(day => {
      const g = document.createElement('div'); g.className = 'search-group';
      const dl = document.createElement('div'); dl.className = 'search-day'; dl.textContent = day;
      g.appendChild(dl);
      renderChildren(store, null, g, 0, requestRender, { refs: byDay[day].map(r => r.ref), mirrorRoot: true });
      mount.appendChild(g);
    });
    // 各ミラールートに ↗（元の場所へ）
    if (onJump) mount.querySelectorAll('.card-row[data-mirror-root]').forEach(row => {
      const holder = row.querySelector('[data-ref]'); if (!holder) return;
      const r = store.getRef(holder.dataset.ref); if (!r) return;
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'mirror-jump'; btn.textContent = '↗'; btn.title = '元の場所へ';
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => { e.stopPropagation(); onJump(r.bodyId); });
      row.appendChild(btn);
    });
  }
  // 入力フォーカスの維持（再描画で消えないよう）
  if (state._refocus){ const el = mount.querySelector(state._refocus === 'kw' ? '.search-kw' : '.search-tags'); state._refocus = null; if (el){ el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }
}
// ── 小物（このモジュール内）──
function labelWrap(label, control){ const f = document.createElement('label'); f.className = 'search-field'; f.appendChild(document.createTextNode(label)); f.appendChild(control); return f; }
function selectEl(opts, val, onChange){ const s = document.createElement('select'); opts.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === val) o.selected = true; s.appendChild(o); }); s.addEventListener('change', () => onChange(s.value)); return s; }
function duePreset(due){ if (!due || due.mode === 'any') return 'any'; if (due.mode === 'none') return 'none'; if (due.to === -1 && due.from == null) return 'overdue'; if (due.from === 0 && due.to === 0) return 'today'; if (due.from === 0 && due.to === 7) return 'soon'; return 'any'; }
function presetToDue(v){ switch (v){ case 'overdue': return { mode:'range', from:null, to:-1 }; case 'today': return { mode:'range', from:0, to:0 }; case 'soon': return { mode:'range', from:0, to:7 }; case 'none': return { mode:'none' }; default: return { mode:'any' }; } }
```

- [ ] **Step 2: CSS を追加**

`v2/style.css` 末尾に追加:
```css
/* 検索ビュー */
#view-search{max-width:860px}
.search-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px}
.search-field{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--tx3)}
.search-field input,.search-field select{font:inherit;font-size:12px;padding:2px 6px;border:1px solid var(--bd2);border-radius:5px;background:var(--panel);color:var(--tx)}
.search-field .search-kw{min-width:160px}
.search-count{font-size:12px;color:var(--tx3);margin-bottom:6px}
.search-empty{color:var(--tx3);font-size:13px}
.search-day{font-size:11px;font-weight:700;color:var(--tx3);background:var(--accent-soft);border-radius:5px;padding:2px 8px;display:inline-block;margin:10px 0 2px}
```

- [ ] **Step 3: パース確認＋全テスト緑**

Run: `cd v2 && node -e "import('./src/search.js').then(()=>console.log('OK'))"` → OK
Run: `cd v2 && for f in tests/*.test.mjs; do node "$f"; done` → すべて PASS

- [ ] **Step 4: 実機確認（ブラウザ）**

タグ/キーワード/PJ/期限/完了/優先度 を変えて結果が AND で絞れる・出所日付でグループ表示・ミラー編集が反映・↗ジャンプ・入力フォーカス維持・ライブ更新 を確認。

- [ ] **Step 5: 版数UP＋CHANGELOG＋コミット**

`v2/src/app.js` の `APP_VERSION` を上げ、`v2/CHANGELOG.md` に Phase1 エントリを追記。
```
git add v2/src/search.js v2/style.css v2/src/app.js v2/CHANGELOG.md
git commit -m "feat(v2): search view — AND query builder + editable-mirror results (search Phase 1)"
```

---

# Phase 2: 保存検索の一覧

## Task 6: 保存検索の保存/読込/改名/削除

**Files:** Modify `v2/src/search.js`, `v2/style.css`

- [ ] **Step 1: 保存バーを `renderSearchView` に追加**

`renderSearchView` の `bar` 追加直後（`mount.appendChild(bar)` の後）に、保存バーを追加:
```js
  mount.appendChild(buildSavedBar(store, requestRender, state));
```
`search.js` に追加:
```js
function buildSavedBar(store, requestRender, state){
  const bar = document.createElement('div'); bar.className = 'search-saved';
  const saved = store.listViews().filter(v => v.kind === 'search');
  // 読込 select
  const sel = document.createElement('select'); sel.className = 'search-load';
  const cur = document.createElement('option'); cur.value = ''; cur.textContent = '（保存した検索）'; sel.appendChild(cur);
  saved.forEach(v => { const o = document.createElement('option'); o.value = v.id; o.textContent = v.name; if (state._savedId === v.id) o.selected = true; sel.appendChild(o); });
  sel.addEventListener('change', () => {
    const v = saved.find(x => x.id === sel.value);
    if (v){ state.query = cloneQuery(v.query); state._savedId = v.id; } else { state._savedId = null; }
    requestRender();
  });
  bar.appendChild(sel);
  // 名前＋保存
  const name = document.createElement('input'); name.type = 'text'; name.className = 'search-name'; name.placeholder = '検索名'; name.value = state._draftName || '';
  name.addEventListener('input', () => { state._draftName = name.value; });
  bar.appendChild(name);
  const save = document.createElement('button'); save.type = 'button'; save.className = 'btn'; save.textContent = '保存';
  save.onclick = () => {
    const nm = (state._draftName || '').trim(); if (!nm){ name.focus(); return; }
    const v = store.saveView({ kind:'search', name: nm, query: cloneQuery(state.query) });
    state._savedId = v.id; state._draftName = ''; requestRender();
  };
  bar.appendChild(save);
  if (state._savedId){
    const over = document.createElement('button'); over.type = 'button'; over.className = 'btn'; over.textContent = '上書き';
    over.onclick = () => { store.updateView(state._savedId, { query: cloneQuery(state.query) }); requestRender(); };
    bar.appendChild(over);
    const del = document.createElement('button'); del.type = 'button'; del.className = 'btn'; del.textContent = '削除';
    del.onclick = () => { store.deleteView(state._savedId); state._savedId = null; requestRender(); };
    bar.appendChild(del);
  }
  return bar;
}
function cloneQuery(q){ return JSON.parse(JSON.stringify(q || {})); }
```

- [ ] **Step 2: CSS 追加**

`v2/style.css` の検索ビュー節に追加:
```css
.search-saved{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
.search-saved .search-load,.search-saved .search-name{font:inherit;font-size:12px;padding:2px 6px;border:1px solid var(--bd2);border-radius:5px;background:var(--panel);color:var(--tx)}
```

- [ ] **Step 3: 全テスト緑＋パース**

Run: `cd v2 && node -e "import('./src/search.js').then(()=>console.log('OK'))"` → OK
Run: `cd v2 && for f in tests/*.test.mjs; do node "$f"; done` → すべて PASS
（`store.saveView/updateView/deleteView` は既存 `store.views` テストで担保済み）

- [ ] **Step 4: 実機確認**

条件を組む→名前を付けて保存→別条件に変更→保存検索を select で読込＝復元／上書き／削除 を確認。

- [ ] **Step 5: 版数UP＋CHANGELOG＋コミット**

```
git add v2/src/search.js v2/style.css v2/src/app.js v2/CHANGELOG.md
git commit -m "feat(v2): saved searches (save/load/overwrite/delete) in search view (search Phase 2)"
```

---

# Phase 3: 保存検索へのリンク（`⟦s:id⟧` チップ）

## Task 7: `@` ポップアップに保存検索を出し `⟦s:id⟧` を挿入

**Files:** Modify `v2/src/daily.js`, `v2/src/app.js`

- [ ] **Step 1: `openMentionSearch` の候補に保存検索を追加**

`v2/src/daily.js` の `openMentionSearch` 内 `compute(q)` の日付候補の後に追加（`store.listViews` を使用）:
```js
    store.listViews().filter(v => v.kind === 'search' && (!ql || (v.name || '').toLowerCase().includes(ql)))
      .slice(0, 8)
      .forEach(v => out.push({ label: '🔍 ' + v.name, hint: '保存検索', run: () => onPick('s:' + v.id) }));
```
`onKey` の `@` 挿入部（`const ins = targetId ? '⟦' + targetId + '⟧' : '@';`）はそのままで良い（`targetId` が `s:<id>` でも `⟦s:<id>⟧` になる）。

- [ ] **Step 2: `makeChip` と `fillEditable` を `⟦s:id⟧` 対応に**

`v2/src/daily.js` の `makeChip(targetId, store)` を、`s:` 接頭辞なら検索チップにする:
```js
function makeChip(targetId, store){
  const sp = document.createElement('span');
  sp.contentEditable = 'false'; sp.dataset.ref = targetId;
  if (String(targetId).startsWith('s:')){                 // 保存検索リンク
    const vid = targetId.slice(2);
    const v = store.listViews().find(x => x.id === vid);
    sp.className = 'mention search-link';
    sp.textContent = '🔍 ' + (v ? v.name : '検索');
    if (!v) sp.classList.add('broken');
    sp.addEventListener('mousedown', (e) => { e.preventDefault(); if (_openSavedSearch) _openSavedSearch(vid); });
    return sp;
  }
  sp.className = 'mention';
  const b = store.getBody(targetId);
  sp.textContent = '@' + (b ? (b.kind === 'day' ? b.content : (b.content || '無題').slice(0, 24)) : '?');
  if (!b) sp.classList.add('broken');
  sp.addEventListener('mousedown', (e) => { e.preventDefault(); if (_mentionJump) _mentionJump(targetId); });
  return sp;
}
```
（`fillEditable`/`serializeEditable`/`caretOffset` は `⟦...⟧` 全般を扱うため変更不要。`mlen` の mention 判定は `'⟦' + dataset.ref + '⟧'` の長さ＝`⟦s:id⟧` の長さと一致するため正しい。）

`daily.js` に opener 変数と setter を追加（`_mentionJump` の近く）:
```js
let _openSavedSearch = null;
export function setSavedSearchOpener(fn){ _openSavedSearch = fn; }
```

- [ ] **Step 3: app.js に `openSavedSearch` を実装・配線**

`v2/src/app.js` の import に `setSavedSearchOpener` を追加:
```js
const { ..., setMentionJump, setEmbedOpener /* もし無ければ既存の並びに合わせる */ } = ...
```
（daily.js の import 行に `setSavedSearchOpener` を追記）。
`openProject` 等の近くに:
```js
function openSavedSearch(viewId){
  const v = store.listViews().find(x => x.id === viewId && x.kind === 'search');
  if (!v) return;
  navPush();
  searchState.query = JSON.parse(JSON.stringify(v.query || {}));
  searchState._savedId = v.id;
  showView('search');
  renderAll();
}
```
init に配線:
```js
  setSavedSearchOpener(openSavedSearch);
```

- [ ] **Step 4: CSS（検索リンクチップ）**

`v2/style.css` の `.mention` 付近に追加:
```css
.mention.search-link{color:#7a5cd0;background:rgba(122,92,208,.12)}
```

- [ ] **Step 5: パース＋全テスト緑**

Run: `cd v2 && node -e "Promise.all(['./src/daily.js','./src/search.js','./src/list.js'].map(m=>import(m))).then(()=>console.log('OK'))"` → OK
Run: `cd v2 && for f in tests/*.test.mjs; do node "$f"; done` → すべて PASS

- [ ] **Step 6: 実機確認**

保存検索を作る→カード本文で `@`→保存検索を選択→`⟦s:id⟧` チップ挿入→チップクリックで検索ビューに遷移しその保存検索の結果表示。往復（編集→再描画でチップ維持）を確認。

- [ ] **Step 7: 版数UP＋CHANGELOG＋コミット**

```
git add v2/src/daily.js v2/src/app.js v2/style.css v2/CHANGELOG.md
git commit -m "feat(v2): link to a saved search from card text (⟦s:id⟧ chip) (search Phase 3)"
```

---

## Self-Review 結果

- **Spec coverage**: 全カード対象＝`matchCard`(memo/task)/Task2、AND条件(keyword/tag/proj/due今日基準/done/prio)＝Task2・Task5、編集可能ミラー＝Task5、ライブ＝requestRender、保存検索の専用一覧＝Task6、保存検索へのリンク＝Task7。今日基準プリセットは `presetToDue`/`duePreset`。重複除外＝`runQuery`/Task3。すべて対応。
- **Placeholder scan**: TBD等なし。各コードステップに実コード記載。UIの「詳細は実装時」等の逃げ無し。
- **Type consistency**: `query` 形（keyword/tags[]/proj/due{mode,from,to}/done{mode}/prio）は Task2・Task4・Task5・Task6・Task7 で一貫。`runQuery`→`{ref, body}`、`sourceDay(store, refId)`、`renderSearchView(store, mount, requestRender, state, onJump)`、`store.saveView({kind:'search',name,query})`、`⟦s:id⟧`＝`makeChip`/`openSavedSearch` で整合。
- **再利用**: `dueGroupMatch`/`projMatch` は Task1 で export。`renderChildren` の `{refs,mirrorRoot}` は既存シグネチャ通り。
- **デグレ**: 既存テストは Task1（export追加のみ）で不変。search は新規モジュールで独立。
