# リストの検索条件拡張（条件グループ・OR）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the list view filter tasks with multiple OR'd condition groups (each group ANDs due-date range / done-date range / project / mid / priority), add a sort direction toggle, and start recording `doneAt` so "completed within N days" is possible.

**Architecture:** `store.js` gains automatic `doneAt` stamping inside `updateBody`. `list.js`'s pure filtering logic (`selectTasks`) is rewritten to match against an array of condition-group objects (OR across groups, AND within a group) instead of three flat fields; a `viewToGroups` migration function lets old saved views (pre-existing `hideDone`/`dueFilter`/`projFilter` shape) keep working. The UI layer (`buildControls`) is rewritten to render one card per group plus an "add group" button, and a sort-direction toggle button.

**Tech Stack:** Vanilla JS (ES modules), no build step. Tests are plain Node scripts using `node:assert/strict`, run individually with `node v2/tests/<file>.test.mjs`.

**Reference spec:** `docs/superpowers/specs/2026-07-01-list-filter-groups.md`

---

## File Structure

| File | Change |
|---|---|
| `v2/src/store.js` | `updateBody` auto-stamps `doneAt` when `done` flips to `true`/`false`. |
| `v2/tests/store.doneat.test.mjs` | **New.** Unit tests for the `doneAt` stamping behavior. |
| `v2/src/list.js` | Rewrite the pure filter/sort logic (`selectTasks` + helpers) to the group model; add `viewToGroups` migration; rewrite the filter UI (`buildControls` and friends); update `buildViewBar`'s save payload and `applyView`; update `renderList`'s call to `selectTasks`. |
| `v2/tests/list.select.test.mjs` | Full rewrite to the new group-based `selectTasks`/`viewToGroups` API. |
| `v2/style.css` | Remove the now-unused `.list-cb` rule; add styles for the condition-group cards and the sort-direction button. |
| `v2/src/app.js` | `listState` initial shape drops `hideDone`/`dueFilter`/`projFilter`, adds `sortDir`. Bump `APP_VERSION`. |
| `v2/CHANGELOG.md` | New version entry. |

No changes needed to `v2/src/daily.js`, `v2/src/project.js`, or `v2/tests/store.views.test.mjs` (that test only exercises the store's opaque view storage, not `list.js`'s interpretation of view contents).

---

### Task 1: Record `doneAt` automatically in the store

**Files:**
- Modify: `v2/src/store.js`
- Create: `v2/tests/store.doneat.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `v2/tests/store.doneat.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const s = createStore();
const { body } = s.createCard({ kind:'task', content:'見積' });
assert.equal(body.doneAt, undefined, '作成直後は doneAt 無し');

// 未完了→完了: doneAt が記録される
s.updateBody(body.id, { done:true });
const afterDone = s.getBody(body.id);
assert.equal(afterDone.done, true);
assert.ok(afterDone.doneAt, 'doneAt が記録される');
assert.ok(!Number.isNaN(Date.parse(afterDone.doneAt)), 'doneAt はISO日時として解釈できる');

// 完了→未完了: doneAt が消える
s.updateBody(body.id, { done:false });
assert.equal(s.getBody(body.id).done, false);
assert.equal(s.getBody(body.id).doneAt, undefined, 'doneAt が消える');

// done を含まない更新では doneAt は変化しない
s.updateBody(body.id, { done:true });
const stamped = s.getBody(body.id).doneAt;
s.updateBody(body.id, { content:'見積(改)' });
assert.equal(s.getBody(body.id).doneAt, stamped, 'doneAt を含まない更新では変化しない');

// 既に完了中に done:true を再度送っても doneAt は上書きされない（連打対策）
s.updateBody(body.id, { done:true });
assert.equal(s.getBody(body.id).doneAt, stamped, '既に完了中の再度の done:true では doneAt は据え置き');

console.log('PASS store.doneat');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node v2/tests/store.doneat.test.mjs`
Expected: `AssertionError` on the `assert.ok(afterDone.doneAt, ...)` line — `doneAt` is not implemented yet, so it's `undefined`.

- [ ] **Step 3: Implement `doneAt` stamping**

In `v2/src/store.js`, find this line (inside `createStore`):

```js
  function updateBody(id, patch){ const b=S.bodies[id]; if(b){ Object.assign(b, patch, {id}); emit(); } return b; }
```

Replace it with:

```js
  function updateBody(id, patch){
    const b = S.bodies[id]; if (!b) return b;
    if ('done' in patch){
      if (patch.done && !b.done) patch = { ...patch, doneAt: nowIso() };   // 未完了→完了: 完了日時を記録
      else if (!patch.done) patch = { ...patch, doneAt: undefined };       // 完了→未完了: 記録を消去
    }
    Object.assign(b, patch, {id}); emit(); return b;
  }
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node v2/tests/store.doneat.test.mjs`
Expected: `PASS store.doneat`

- [ ] **Step 5: Run the existing store tests to check for regressions**

Run:
```bash
node v2/tests/store.core.test.mjs
node v2/tests/store.tree.test.mjs
node v2/tests/store.gc.test.mjs
node v2/tests/store.query.test.mjs
node v2/tests/store.struct.test.mjs
node v2/tests/store.views.test.mjs
node v2/tests/store.projects.test.mjs
node v2/tests/store.projectpage.test.mjs
node v2/tests/store.replace.test.mjs
node v2/tests/store.history.test.mjs
```
Expected: every line prints its own `PASS ...`, no errors. (`store.core.test.mjs` already calls `updateBody(body.id, {done:true})` at line 25 — it only asserts `.done`/`.id`, unaffected by the new `doneAt` field.)

Do not commit yet — commits happen once at the end of the whole plan (Task 5), matching this project's established workflow (one commit + push per shipped feature).

---

### Task 2: Rewrite the filter/sort pure logic to condition groups

**Files:**
- Modify: `v2/src/list.js`
- Modify: `v2/tests/list.select.test.mjs` (full rewrite)

- [ ] **Step 1: Write the new test file (this will fail against the current implementation)**

Replace the entire contents of `v2/tests/list.select.test.mjs` with:

```js
import assert from 'node:assert/strict';
import { selectTasks, viewToGroups } from '../src/list.js';

const today = '2026-06-17';
const tasks = [
  { id:'1', content:'A', due:'2026-06-18', prio:1, createdAt:'2026-06-01T00:00:00Z' }, // +1日
  { id:'2', content:'B', due:'2026-06-25', prio:3, createdAt:'2026-06-02T00:00:00Z' }, // +8日
  { id:'3', content:'C', due:'2026-06-10', prio:0, done:true, doneAt:'2026-06-16T10:00:00Z', createdAt:'2026-06-03T00:00:00Z' }, // -7日(期限切れ・完了・完了日-1日)
  { id:'4', content:'D', createdAt:'2026-06-04T00:00:00Z' },                            // 期限なし
];
// 条件グループの雛形（既定=すべて）に部分的な上書きをマージするヘルパ
const g = (patch) => ({
  due:{mode:'any',from:null,to:null}, done:{mode:'any',from:null,to:null},
  proj:'all', mid:'', prio:'all', ...patch,
});

// opts省略・空groups → 既定1グループ（絞り込みなし）で全件
assert.equal(selectTasks(tasks, undefined, today).length, 4, '既定は全件表示（絞り込みなし）');

// 期限=範囲(0〜3) → A のみ（旧 next3 相当）
assert.deepEqual(selectTasks(tasks, { groups:[g({ due:{mode:'range',from:0,to:3} })], sort:'due' }, today).map(t=>t.id), ['1']);
// 期限=範囲(無制限〜-1) → C のみ（旧 overdue 相当）
assert.deepEqual(selectTasks(tasks, { groups:[g({ due:{mode:'range',from:null,to:-1} })] }, today).map(t=>t.id), ['3']);
// 期限=範囲(無制限〜0) → C のみ（旧 today 相当）
assert.deepEqual(selectTasks(tasks, { groups:[g({ due:{mode:'range',from:null,to:0} })] }, today).map(t=>t.id), ['3']);
// 期限=なし → D のみ
assert.deepEqual(selectTasks(tasks, { groups:[g({ due:{mode:'none'} })] }, today).map(t=>t.id), ['4']);
// 期限=範囲(無制限〜無制限) → 期限があるもの全部（旧 has 相当・期限昇順）
assert.deepEqual(selectTasks(tasks, { groups:[g({ due:{mode:'range',from:null,to:null} })], sort:'due' }, today).map(t=>t.id), ['3','1','2']);

// 完了=未完了のみ ＋ 期限昇順（期限なしは末尾）→ 旧 hideDone 相当
assert.deepEqual(selectTasks(tasks, { groups:[g({ done:{mode:'notDone',from:null,to:null} })], sort:'due' }, today).map(t=>t.id), ['1','2','4']);
// 完了=完了のみ・期間指定なし → C のみ
assert.deepEqual(selectTasks(tasks, { groups:[g({ done:{mode:'done',from:null,to:null} })] }, today).map(t=>t.id), ['3']);
// 完了=完了のみ・完了日が直近3日以内(-3〜0) → C（doneAt=-1日）
assert.deepEqual(selectTasks(tasks, { groups:[g({ done:{mode:'done',from:-3,to:0} })] }, today).map(t=>t.id), ['3']);
// 完了=完了のみ・完了日が10〜100日前 → 該当なし
assert.deepEqual(selectTasks(tasks, { groups:[g({ done:{mode:'done',from:-100,to:-10} })] }, today).map(t=>t.id), []);
// doneAt が無い完了タスクは、完了日の範囲指定に一致しない（期間指定なしなら一致する）
const noDoneAt = [{ id:'x', content:'X', done:true, createdAt:'2026-06-01T00:00:00Z' }];
assert.deepEqual(selectTasks(noDoneAt, { groups:[g({ done:{mode:'done',from:-30,to:0} })] }, today).map(t=>t.id), []);
assert.deepEqual(selectTasks(noDoneAt, { groups:[g({ done:{mode:'done',from:null,to:null} })] }, today).map(t=>t.id), ['x']);

// 優先度フィルタ
assert.deepEqual(selectTasks(tasks, { groups:[g({ prio:'3' })] }, today).map(t=>t.id), ['2']);

// 中項目（部分一致）フィルタ
const pj3 = [
  { id:'a', content:'A', proj:'p1', mid:'設計', createdAt:'2026-06-01T00:00:00Z' },
  { id:'b', content:'B', proj:'p1', mid:'実装', createdAt:'2026-06-02T00:00:00Z' },
  { id:'c', content:'C', proj:'p1',             createdAt:'2026-06-03T00:00:00Z' },
  { id:'d', content:'D', proj:'p1', mid:'設計', createdAt:'2026-06-04T00:00:00Z' },
];
assert.deepEqual(selectTasks(pj3, { groups:[g({ mid:'設計' })], sort:'title' }, today).map(t=>t.id), ['a','d']);
assert.deepEqual(selectTasks(pj3, { groups:[g({ mid:'設計' })], sort:'proj' }, today, { p1:0 }).map(t=>t.id), ['a','d'], 'プロジェクト並べ替えでも中項目フィルタは効く');

// projFilter（プロジェクト帰属）
const pj = [
  { id:'a', content:'A', proj:'p1', createdAt:'2026-06-01T00:00:00Z' },
  { id:'b', content:'B', proj:'p2', createdAt:'2026-06-02T00:00:00Z' },
  { id:'c', content:'C',            createdAt:'2026-06-03T00:00:00Z' }, // 未割当
];
assert.deepEqual(selectTasks(pj, { groups:[g({ proj:'p1' })], sort:'created' }, today).map(t=>t.id), ['a']);
assert.deepEqual(selectTasks(pj, { groups:[g({ proj:'none' })], sort:'created' }, today).map(t=>t.id), ['c']);
assert.deepEqual(selectTasks(pj, { groups:[g({ proj:'all' })],  sort:'created' }, today).map(t=>t.id), ['a','b','c']);

// プロジェクト単位の並び替え（projOrderで群順・群内は期限昇順・未割当は最後）
const pj2 = [
  { id:'x', content:'X', proj:'p2', due:'2026-06-20', createdAt:'2026-06-01T00:00:00Z' },
  { id:'y', content:'Y', proj:'p1', due:'2026-06-25', createdAt:'2026-06-02T00:00:00Z' },
  { id:'z', content:'Z',            createdAt:'2026-06-03T00:00:00Z' },                    // 未割当→最後
  { id:'w', content:'W', proj:'p1', due:'2026-06-22', createdAt:'2026-06-04T00:00:00Z' },
];
const order = { p1:0, p2:1 };
assert.deepEqual(selectTasks(pj2, { sort:'proj' }, today, order).map(t=>t.id), ['w','y','x','z']);
assert.deepEqual(selectTasks(pj2, { sort:'proj', sortDir:'desc' }, today, order).map(t=>t.id), ['w','y','x','z'], 'プロジェクト表示は昇降順トグルの影響を受けない');
// projOrder 未指定でも落ちない
assert.equal(selectTasks(pj2, { sort:'proj' }, today).length, 4);

// 優先度降順（高い順）: B(3) が先頭（既定 sortDir='asc' はこの並びをそのまま使う）
assert.equal(selectTasks(tasks, { sort:'priority' }, today)[0].id, '2');

// 作成日昇順
assert.deepEqual(selectTasks(tasks, { sort:'created' }, today).map(t=>t.id), ['1','2','3','4']);

// 並べ替え方向（降順）: due昇順の逆になる（期限なしの位置も含め一貫して反転）
assert.deepEqual(selectTasks(tasks, { sort:'due' }, today).map(t=>t.id), ['3','1','2','4'], '期限昇順（期限なしは末尾）');
assert.deepEqual(selectTasks(tasks, { sort:'due', sortDir:'desc' }, today).map(t=>t.id), ['4','2','1','3'], '期限降順（比較関数の符号反転＝期限なしの位置も反転）');

// 2グループのOR: 「1ヶ月以内に完了」OR「今後1週間が期限」を期限降順
const orResult = selectTasks(tasks, {
  groups: [
    g({ done:{mode:'done',from:-30,to:0} }),
    g({ due:{mode:'range',from:0,to:7} }),
  ],
  sort:'due', sortDir:'desc',
}, today);
assert.deepEqual(orResult.map(t=>t.id), ['1','3'], 'A(期限+1日)とC(完了)が該当・期限降順');

// ── viewToGroups: 保存済みビューのマイグレーション ──
assert.deepEqual(viewToGroups({})[0].due, { mode:'any', from:null, to:null }, '未指定/allはany');
assert.deepEqual(viewToGroups({ dueFilter:'next3' })[0].due, { mode:'range', from:0, to:3 });
assert.deepEqual(viewToGroups({ dueFilter:'overdue' })[0].due, { mode:'range', from:null, to:-1 });
assert.deepEqual(viewToGroups({ dueFilter:'today' })[0].due, { mode:'range', from:null, to:0 });
assert.deepEqual(viewToGroups({ dueFilter:'has' })[0].due, { mode:'range', from:null, to:null });
assert.deepEqual(viewToGroups({ dueFilter:'none' })[0].due, { mode:'none', from:null, to:null });
assert.deepEqual(viewToGroups({ hideDone:true })[0].done, { mode:'notDone', from:null, to:null });
assert.deepEqual(viewToGroups({})[0].done, { mode:'any', from:null, to:null });
assert.equal(viewToGroups({ projFilter:'p1' })[0].proj, 'p1');
assert.equal(viewToGroups({})[0].proj, 'all');
assert.equal(viewToGroups({ hideDone:true, dueFilter:'next3', projFilter:'p1' }).length, 1);

// 新形式（groups あり）はそのまま使う。欠けたフィールドは defaultGroup で補完
const passthrough = viewToGroups({ groups: [{ proj:'p9' }] });
assert.equal(passthrough.length, 1);
assert.equal(passthrough[0].proj, 'p9');
assert.deepEqual(passthrough[0].due, { mode:'any', from:null, to:null }, '欠けていたdueはdefaultGroupで補完');
assert.deepEqual(passthrough[0].mid, '');

console.log('PASS list.select');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node v2/tests/list.select.test.mjs`
Expected: fails with an import/assertion error — `viewToGroups` doesn't exist yet, and `selectTasks` doesn't understand `opts.groups` yet (it still reads the old flat `hideDone`/`dueFilter`/`projFilter` fields, so passing `{groups:[...]}` is silently ignored and the assertions on filtered results mismatch).

- [ ] **Step 3: Implement the group-based filtering logic**

In `v2/src/list.js`, replace this whole block (the `// ── 純ロジック（テスト対象）──` section, from `let _onJump` through the end of the original `sortCmp` function, i.e. everything up to and including the line `}` that closes `sortCmp`):

```js
// ── 純ロジック（テスト対象）──
let _onJump = null;    // 行の「↗」→デイリーで該当カードを開くコールバック
let _listCtx = null;   // { store, requestRender, state } 折りたたみ(Ctrl+↑↓)・ポップアップ用

export function selectTasks(tasks, opts, today, projOrder){
  const { hideDone=false, dueFilter='all', projFilter='all', sort='proj' } = opts || {};
  let out = tasks.slice();
  if (hideDone) out = out.filter(t => !t.done);
  out = out.filter(t => dueMatch(t.due, dueFilter, today));
  out = out.filter(t => projMatch(t.proj, projFilter));
  out.sort(sortCmp(sort, projOrder || {}));
  return out;
}
function dueMatch(due, filter, today){
  if (filter === 'all')  return true;
  if (filter === 'none') return !due;
  if (filter === 'has')  return !!due;
  if (!due) return false;
  const d = dayDiff(due, today);
  if (filter === 'overdue') return d < 0;
  if (filter === 'today')   return d <= 0;
  if (filter === 'next3')   return d >= 0 && d <= 3;
  return true;
}
function projMatch(proj, filter){
  if (filter === 'all')  return true;
  if (filter === 'none') return !proj;
  return proj === filter;        // 特定PJのID
}
function dayDiff(due, today){
  return Math.round((Date.parse(due+'T00:00:00') - Date.parse(today+'T00:00:00')) / 86400000);
}
function cmpStr(x, y){ x = x||''; y = y||''; return x < y ? -1 : x > y ? 1 : 0; }
function dueCmp(a, b){
  if (!a.due && !b.due) return 0;
  if (!a.due) return 1;
  if (!b.due) return -1;
  return cmpStr(a.due, b.due);
}
// 中項目の折りたたみキー（描画ループと collapseKey で共通・区切りは proj/mid に出ない制御文字）
function midKeyOf(g, m){ return (g || '') + '' + (m || ''); }
// 中項目の折りたたみ状態（ネスト: midColl[proj][mid]=true）。区切り文字を使わず取り違えを防ぐ
function midIsColl(midColl, g, m){ const o = midColl[g || '']; return !!(o && o[m || '']); }
function midSetColl(midColl, g, m, v){ const o = midColl[g || ''] || (midColl[g || ''] = {}); o[m || ''] = v; }
function sortCmp(sort, projOrder){
  if (sort === 'proj'){                       // プロジェクト→中項目→（期限→優先度→名前）。未割当/中項目なしは末尾
    projOrder = projOrder || {};
    const rank = (t) => !t.proj ? 1e9 : (projOrder[t.proj] != null ? projOrder[t.proj] : 1e9 - 1);
    const hasMid = (t) => t.mid ? 0 : 1;   // 中項目なしは群の末尾
    return (a,b) => rank(a) - rank(b) || hasMid(a) - hasMid(b) || cmpStr(a.mid || '', b.mid || '') || dueCmp(a,b) || (b.prio||0) - (a.prio||0) || cmpStr(a.content, b.content);
  }
  if (sort === 'priority') return (a,b) => (b.prio||0) - (a.prio||0) || cmpStr(a.content, b.content);
  if (sort === 'created')  return (a,b) => cmpStr(a.createdAt, b.createdAt);
  if (sort === 'title')    return (a,b) => cmpStr(a.content, b.content);
  return (a,b) => {
    if (!a.due && !b.due) return cmpStr(a.content, b.content);
    if (!a.due) return 1;
    if (!b.due) return -1;
    return cmpStr(a.due, b.due) || (b.prio||0) - (a.prio||0);
  };
}
```

with:

```js
// ── 純ロジック（テスト対象）──
let _onJump = null;    // 行の「↗」→デイリーで該当カードを開くコールバック
let _listCtx = null;   // { store, requestRender, state } 折りたたみ(Ctrl+↑↓)・ポップアップ用

// 1条件グループの既定値（全項目「すべて」＝絞り込みなし）。呼び出しごとに新しいオブジェクトを返す（状態間の共有を防ぐ）。
function defaultGroup(){
  return {
    due:  { mode: 'any', from: null, to: null },
    done: { mode: 'any', from: null, to: null },
    proj: 'all',
    mid:  '',
    prio: 'all',
  };
}
function dayDiff(due, today){
  return Math.round((Date.parse(due+'T00:00:00') - Date.parse(today+'T00:00:00')) / 86400000);
}
function dueGroupMatch(due, cond, today){
  if (!cond || cond.mode === 'any') return true;
  if (cond.mode === 'none') return !due;
  if (!due) return false;                          // mode === 'range'
  const d = dayDiff(due, today);
  if (cond.from != null && d < cond.from) return false;
  if (cond.to   != null && d > cond.to)   return false;
  return true;
}
function doneGroupMatch(t, cond, today){
  if (!cond || cond.mode === 'any') return true;
  if (cond.mode === 'notDone') return !t.done;
  if (!t.done) return false;                       // mode === 'done'
  if (cond.from == null && cond.to == null) return true;   // 完了日は問わない
  if (!t.doneAt) return false;                      // 完了日時が未記録（過去に完了したタスク）
  const d = dayDiff(t.doneAt.slice(0, 10), today);
  if (cond.from != null && d < cond.from) return false;
  if (cond.to   != null && d > cond.to)   return false;
  return true;
}
function projMatch(proj, filter){
  if (filter === 'all')  return true;
  if (filter === 'none') return !proj;
  return proj === filter;        // 特定PJのID
}
function groupMatch(t, g, today){
  return dueGroupMatch(t.due, g.due, today)
      && doneGroupMatch(t, g.done, today)
      && projMatch(t.proj, g.proj)
      && (!g.mid || (t.mid || '').toLowerCase().includes(g.mid.toLowerCase()))
      && (g.prio === 'all' || String(t.prio || 0) === g.prio);
}
function cmpStr(x, y){ x = x||''; y = y||''; return x < y ? -1 : x > y ? 1 : 0; }
function dueCmp(a, b){
  if (!a.due && !b.due) return 0;
  if (!a.due) return 1;
  if (!b.due) return -1;
  return cmpStr(a.due, b.due);
}
// 中項目の折りたたみキー（描画ループと collapseKey で共通・区切りは proj/mid に出ない制御文字）
function midKeyOf(g, m){ return (g || '') + '' + (m || ''); }
// 中項目の折りたたみ状態（ネスト: midColl[proj][mid]=true）。区切り文字を使わず取り違えを防ぐ
function midIsColl(midColl, g, m){ const o = midColl[g || '']; return !!(o && o[m || '']); }
function midSetColl(midColl, g, m, v){ const o = midColl[g || ''] || (midColl[g || ''] = {}); o[m || ''] = v; }
function sortCmp(sort, projOrder){
  if (sort === 'proj'){                       // プロジェクト→中項目→（期限→優先度→名前）。未割当/中項目なしは末尾
    projOrder = projOrder || {};
    const rank = (t) => !t.proj ? 1e9 : (projOrder[t.proj] != null ? projOrder[t.proj] : 1e9 - 1);
    const hasMid = (t) => t.mid ? 0 : 1;   // 中項目なしは群の末尾
    return (a,b) => rank(a) - rank(b) || hasMid(a) - hasMid(b) || cmpStr(a.mid || '', b.mid || '') || dueCmp(a,b) || (b.prio||0) - (a.prio||0) || cmpStr(a.content, b.content);
  }
  if (sort === 'priority') return (a,b) => (b.prio||0) - (a.prio||0) || cmpStr(a.content, b.content);
  if (sort === 'created')  return (a,b) => cmpStr(a.createdAt, b.createdAt);
  if (sort === 'title')    return (a,b) => cmpStr(a.content, b.content);
  return (a,b) => {
    if (!a.due && !b.due) return cmpStr(a.content, b.content);
    if (!a.due) return 1;
    if (!b.due) return -1;
    return cmpStr(a.due, b.due) || (b.prio||0) - (a.prio||0);
  };
}
// 旧フィルタ形式（dueFilter プリセット）→ 新しい range 条件へのマッピング（保存済みビューの移行用）
function legacyDueToGroup(dueFilter){
  if (dueFilter === 'none')    return { mode:'none',  from:null, to:null };
  if (dueFilter === 'has')     return { mode:'range', from:null, to:null };
  if (dueFilter === 'overdue') return { mode:'range', from:null, to:-1 };
  if (dueFilter === 'today')   return { mode:'range', from:null, to:0 };
  if (dueFilter === 'next3')   return { mode:'range', from:0,    to:3 };
  return { mode:'any', from:null, to:null };   // 'all' または未指定
}
// 保存済みビュー（新旧どちらの形式でも）→ 条件グループ配列。新形式はdefaultGroupで欠けたフィールドを補完するだけ。
export function viewToGroups(v){
  v = v || {};
  if (v.groups && v.groups.length) return v.groups.map(g => ({ ...defaultGroup(), ...g }));
  const g = defaultGroup();
  g.due  = legacyDueToGroup(v.dueFilter);
  g.done = v.hideDone ? { mode:'notDone', from:null, to:null } : { mode:'any', from:null, to:null };
  g.proj = v.projFilter || 'all';
  return [g];
}
export function selectTasks(tasks, opts, today, projOrder){
  const groups = (opts && opts.groups && opts.groups.length) ? opts.groups : [defaultGroup()];
  const sort = (opts && opts.sort) || 'proj';
  const sortDir = (opts && opts.sortDir) || 'asc';
  let cmp = sortCmp(sort, projOrder || {});
  if (sortDir === 'desc' && sort !== 'proj'){ const base = cmp; cmp = (a, b) => -base(a, b); }
  return tasks.filter(t => groups.some(g => groupMatch(t, g, today))).sort(cmp);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node v2/tests/list.select.test.mjs`
Expected: `PASS list.select`

- [ ] **Step 5: Run a syntax check and the other tests that import from list.js**

Run:
```bash
node --check v2/src/list.js
node v2/tests/project.mirror.test.mjs
```
Expected: no syntax errors; `PASS project.mirror` (that file imports `collectMirrorRoots` from `project.js`, which itself imports from `daily.js` — unaffected by this change, but confirms nothing broke transitively).

Do not commit yet.

---

### Task 3: Rewrite the list UI — condition-group cards, add/remove, sort direction, view save/load

**Files:**
- Modify: `v2/src/list.js`

- [ ] **Step 1: Add `ensureGroups`, `cloneGroups`, and the group-card builders**

In `v2/src/list.js`, find the comment line:

```js
// ── フィルタ/並べ替え/列 バー ──
```

Insert the following new functions immediately **before** that comment line (i.e., right after the previous section ends):

```js
function ensureGroups(state){
  if (!state.groups || !state.groups.length) state.groups = [defaultGroup()];
  return state.groups;
}
function cloneGroups(groups){ return groups.map(g => JSON.parse(JSON.stringify(g))); }

function dayRangeInputs(cond, touch, fkeyPrefix){
  const wrap = document.createElement('span'); wrap.className = 'filter-range';
  wrap.appendChild(document.createTextNode('今日から'));
  const from = document.createElement('input');
  from.type = 'number'; from.className = 'filter-range-input'; from.placeholder = '無制限';
  from.dataset.fkey = fkeyPrefix + ':from';
  from.value = cond.from == null ? '' : cond.from;
  from.addEventListener('change', () => { cond.from = from.value === '' ? null : Number(from.value); touch(); });
  wrap.appendChild(from);
  wrap.appendChild(document.createTextNode('〜'));
  const to = document.createElement('input');
  to.type = 'number'; to.className = 'filter-range-input'; to.placeholder = '無制限';
  to.dataset.fkey = fkeyPrefix + ':to';
  to.value = cond.to == null ? '' : cond.to;
  to.addEventListener('change', () => { cond.to = to.value === '' ? null : Number(to.value); touch(); });
  wrap.appendChild(to);
  wrap.appendChild(document.createTextNode('日'));
  return wrap;
}
function buildGroupCard(store, groups, g, i, touch){
  const card = document.createElement('div'); card.className = 'filter-group';

  const dueRow = document.createElement('div'); dueRow.className = 'filter-group-row';
  dueRow.appendChild(labelWrap('期限', selectEl([
    ['any','すべて'], ['range','範囲指定'], ['none','期限なし'],
  ], g.due.mode, v => { g.due.mode = v; touch(); }, 'g'+i+':duemode')));
  if (g.due.mode === 'range') dueRow.appendChild(dayRangeInputs(g.due, touch, 'g'+i+':due'));
  card.appendChild(dueRow);

  const doneRow = document.createElement('div'); doneRow.className = 'filter-group-row';
  doneRow.appendChild(labelWrap('完了', selectEl([
    ['any','すべて'], ['notDone','未完了のみ'], ['done','完了のみ'],
  ], g.done.mode, v => { g.done.mode = v; touch(); }, 'g'+i+':donemode')));
  if (g.done.mode === 'done') doneRow.appendChild(dayRangeInputs(g.done, touch, 'g'+i+':done'));
  card.appendChild(doneRow);

  const row3 = document.createElement('div'); row3.className = 'filter-group-row';
  const projOpts = [['all','すべて'], ['none','未割当'], ...store.listProjects().map(p => [p.id, p.content || '(無題)'])];
  row3.appendChild(labelWrap('PJ', selectEl(projOpts, g.proj, v => { g.proj = v; touch(); }, 'g'+i+':proj')));
  const midInp = document.createElement('input');
  midInp.type = 'text'; midInp.placeholder = '中項目(部分一致)'; midInp.value = g.mid || ''; midInp.setAttribute('list', 'pwt2-mids');
  midInp.dataset.fkey = 'g'+i+':mid';
  midInp.addEventListener('change', () => { g.mid = midInp.value; touch(); });
  row3.appendChild(midInp);
  row3.appendChild(labelWrap('優先度', selectEl([
    ['all','すべて'], ['0','なし'], ['1','低'], ['2','中'], ['3','高'],
  ], g.prio, v => { g.prio = v; touch(); }, 'g'+i+':prio')));
  card.appendChild(row3);

  if (groups.length > 1){
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'filter-group-del'; del.textContent = '×'; del.title = 'この条件グループを削除';
    del.onclick = () => { groups.splice(i, 1); touch(); };
    card.appendChild(del);
  }
  return card;
}
function buildFilterGroups(store, state, touch){
  const groups = ensureGroups(state);
  const wrap = document.createElement('div'); wrap.className = 'filter-groups';
  groups.forEach((g, i) => wrap.appendChild(buildGroupCard(store, groups, g, i, touch)));
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'btn filter-add-group'; addBtn.dataset.fkey = 'addgroup';
  addBtn.textContent = '＋ OR条件を追加';
  addBtn.onclick = () => { groups.push(defaultGroup()); touch(); };
  wrap.appendChild(addBtn);
  return wrap;
}

// ── フィルタ/並べ替え/列 バー ──
```

(Note: the last line above, `// ── フィルタ/並べ替え/列 バー ──`, is the original comment you inserted before — it now sits right before `buildControls`, unchanged.)

- [ ] **Step 2: Rewrite `buildControls`**

Immediately after the comment from Step 1, find the existing `buildControls` function:

```js
function buildControls(store, requestRender, state, shown, total){
  const bar = document.createElement('div');
  bar.className = 'list-controls';
  const touch = () => { state._viewId = null; requestRender(); };

  bar.appendChild(labelWrap('期限', selectEl([
    ['all','すべて'], ['next3','今後3日以内'], ['today','今日まで'],
    ['overdue','期限切れ'], ['has','期限あり'], ['none','期限なし'],
  ], state.dueFilter, v => { state.dueFilter = v; touch(); }, 'filter-due')));

  const projOpts = [['all','すべて'], ['none','未割当'],
    ...store.listProjects().map(p => [p.id, p.content || '(無題)'])];
  bar.appendChild(labelWrap('PJ', selectEl(projOpts, state.projFilter || 'all', v => { state.projFilter = v; touch(); }, 'filter-proj')));

  bar.appendChild(labelWrap('並べ替え', selectEl([
    ['proj','プロジェクト'], ['due','期限'], ['priority','優先度'], ['created','作成日'], ['title','タイトル'],
  ], state.sort, v => { state.sort = v; touch(); }, 'sort')));

  const cbWrap = document.createElement('label');
  cbWrap.className = 'list-cb';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = !!state.hideDone;
  cb.dataset.fkey = 'hidedone';
  cb.onchange = () => { state.hideDone = cb.checked; touch(); };
  cbWrap.appendChild(cb); cbWrap.appendChild(document.createTextNode('完了を隠す'));
  bar.appendChild(cbWrap);

  bar.appendChild(buildColumnPicker(state, touch));

  const count = document.createElement('span');
  count.className = 'list-count';
  count.textContent = `${shown} / ${total} 件`;
  bar.appendChild(count);
  return bar;
}
```

Replace it with:

```js
function buildControls(store, requestRender, state, shown, total){
  const wrap = document.createElement('div'); wrap.className = 'list-controls-wrap';
  const touch = () => { state._viewId = null; requestRender(); };

  wrap.appendChild(buildFilterGroups(store, state, touch));

  const bar = document.createElement('div');
  bar.className = 'list-controls';

  bar.appendChild(labelWrap('並べ替え', selectEl([
    ['proj','プロジェクト'], ['due','期限'], ['priority','優先度'], ['created','作成日'], ['title','タイトル'],
  ], state.sort, v => { state.sort = v; touch(); }, 'sort')));

  const dirBtn = document.createElement('button');
  dirBtn.type = 'button'; dirBtn.className = 'btn sort-dir-btn'; dirBtn.dataset.fkey = 'sortdir';
  dirBtn.textContent = state.sortDir === 'desc' ? '▼ 降順' : '▲ 昇順';
  dirBtn.disabled = state.sort === 'proj';
  dirBtn.title = state.sort === 'proj' ? 'プロジェクト表示では階層順（昇降順の指定は不可）' : '';
  dirBtn.onclick = () => { state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc'; touch(); };
  bar.appendChild(dirBtn);

  bar.appendChild(buildColumnPicker(state, touch));

  const count = document.createElement('span');
  count.className = 'list-count';
  count.textContent = `${shown} / ${total} 件`;
  bar.appendChild(count);

  wrap.appendChild(bar);
  return wrap;
}
```

- [ ] **Step 3: Update `renderList` to pass groups/sortDir to `selectTasks`**

Find this line inside `renderList`:

```js
  let rows = selectTasks(all, state, today, projOrder);
```

Replace it with:

```js
  const groups = ensureGroups(state);
  let rows = selectTasks(all, { groups, sort: state.sort, sortDir: state.sortDir }, today, projOrder);
```

- [ ] **Step 4: Update the "save view" payload in `buildViewBar`**

Find:

```js
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn'; saveBtn.textContent = '保存';
  saveBtn.onclick = () => {
    const nm = (state._draftName || '').trim();
    if (!nm){ name.focus(); return; }
    const v = store.saveView({
      name: nm, hideDone: state.hideDone, dueFilter: state.dueFilter,
      projFilter: state.projFilter || 'all', sort: state.sort, columns: activeColumns(state).slice(),
    });
    state._viewId = v.id; state._draftName = '';
    requestRender();
  };
  bar.appendChild(saveBtn);
```

Replace with:

```js
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn'; saveBtn.textContent = '保存';
  saveBtn.onclick = () => {
    const nm = (state._draftName || '').trim();
    if (!nm){ name.focus(); return; }
    const v = store.saveView({
      name: nm, groups: cloneGroups(ensureGroups(state)),
      sort: state.sort, sortDir: state.sortDir || 'asc', columns: activeColumns(state).slice(),
    });
    state._viewId = v.id; state._draftName = '';
    requestRender();
  };
  bar.appendChild(saveBtn);
```

- [ ] **Step 5: Update `applyView` to use `viewToGroups`**

Find:

```js
function applyView(state, v){
  state.hideDone = !!v.hideDone;
  state.dueFilter = v.dueFilter || 'all';
  state.projFilter = v.projFilter || 'all';
  state.sort = v.sort || 'proj';
  state.columns = (v.columns && v.columns.length ? v.columns.slice() : DEFAULT_COLUMNS.slice());
  state._viewId = v.id;
}
```

Replace with:

```js
function applyView(state, v){
  state.groups = cloneGroups(viewToGroups(v));   // 新旧どちらの保存形式でも読み込める（旧形式は自動でグループへ変換）
  state.sort = v.sort || 'proj';
  state.sortDir = v.sortDir === 'desc' ? 'desc' : 'asc';
  state.columns = (v.columns && v.columns.length ? v.columns.slice() : DEFAULT_COLUMNS.slice());
  state._viewId = v.id;
}
```

- [ ] **Step 6: Syntax-check and run the unit tests again**

Run:
```bash
node --check v2/src/list.js
node v2/tests/list.select.test.mjs
node v2/tests/project.mirror.test.mjs
```
Expected: no syntax errors; both print their `PASS ...` line. (The UI functions added in this task aren't unit-testable in Node since they touch `document` — they'll be checked in the browser next.)

Do not commit yet.

---

### Task 4: Style the condition-group cards and sort-direction button

**Files:**
- Modify: `v2/style.css`

- [ ] **Step 1: Remove the now-unused `.list-cb` rule and add the new rules**

In `v2/style.css`, find this line:

```css
.list-cb{display:flex;align-items:center;gap:5px;color:var(--tx3);cursor:pointer}
```

Replace it with:

```css
/* 検索条件グループ（OR） */
.filter-groups{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}
.filter-group{position:relative;display:flex;flex-direction:column;gap:6px;padding:8px 34px 8px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--panel);font-size:12px}
.filter-group-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.filter-group-row input[type=text]{font:inherit;font-size:12px;padding:2px 6px;border:1px solid var(--bd2);border-radius:5px;background:var(--bg);color:var(--tx);width:140px}
.filter-range{display:flex;align-items:center;gap:4px;color:var(--tx3)}
.filter-range-input{width:52px;font:inherit;font-size:12px;padding:2px 4px;border:1px solid var(--bd2);border-radius:5px;background:var(--bg);color:var(--tx)}
.filter-group-del{position:absolute;top:6px;right:6px;width:20px;height:20px;line-height:18px;padding:0;border:1px solid var(--bd2);border-radius:5px;background:var(--panel);color:var(--tx3);cursor:pointer}
.filter-group-del:hover{border-color:#d9534f;color:#d9534f}
.filter-add-group{align-self:flex-start;font-size:12px}
.sort-dir-btn{font-size:12px;padding:2px 9px}
.sort-dir-btn:disabled{opacity:.4;cursor:default}
```

- [ ] **Step 2: Verify in the browser**

Start the preview server (`weekly-static`, serving `v2/index.html`) if not already running, then reload and switch to the リスト view. In the browser console (`preview_eval`), run:

```js
(() => {
  document.getElementById('view-list-btn').click();
  const groups = document.querySelectorAll('.filter-groups .filter-group');
  const addBtn = document.querySelector('.filter-add-group');
  const dirBtn = document.querySelector('.sort-dir-btn');
  return {
    groupCount: groups.length,               // expect 1 (default group)
    hasAddBtn: !!addBtn,
    dirBtnText: dirBtn ? dirBtn.textContent : null,   // expect '▲ 昇順' (default sort is 'proj', so should be disabled)
    dirBtnDisabled: dirBtn ? dirBtn.disabled : null,  // expect true (sort defaults to 'proj')
  };
})()
```

Expected: `{ groupCount: 1, hasAddBtn: true, dirBtnText: '▲ 昇順', dirBtnDisabled: true }`.

Then verify adding/removing a group and the OR-filter behavior end-to-end:

```js
(() => {
  const s = window.__store;
  const day = s.ensureDayCard(new Date().toISOString().slice(0,10));
  const mk = (c, patch) => { if (!s.queryBodies(b=>b.content===c).length) s.createCard({ kind:'task', content:c, parentRefId: day.ref.id, ...patch }); };
  mk('近い期限タスク', { due: new Date(Date.now()+2*86400000).toISOString().slice(0,10) });   // 2日後
  const oldDone = s.createCard({ kind:'task', content:'古い完了タスク', parentRefId: day.ref.id });
  s.updateBody(oldDone.body.id, { done: true });   // doneAt が今スタンプされる（=直近0日前）

  document.getElementById('view-list-btn').click();
  const sortSel = document.querySelector('[data-fkey="sort"]');
  sortSel.value = 'due'; sortSel.dispatchEvent(new Event('change', { bubbles: true }));

  // グループ1: 完了のみ・完了日は直近30日以内
  const doneModeSel = document.querySelector('[data-fkey="g0:donemode"]');
  doneModeSel.value = 'done'; doneModeSel.dispatchEvent(new Event('change', { bubbles: true }));
  const doneFrom = document.querySelector('[data-fkey="g0:done:from"]');
  doneFrom.value = '-30'; doneFrom.dispatchEvent(new Event('change', { bubbles: true }));

  // ＋OR条件を追加 → グループ2: 期限が今後7日以内
  document.querySelector('.filter-add-group').click();
  const dueModeSel = document.querySelector('[data-fkey="g1:duemode"]');
  dueModeSel.value = 'range'; dueModeSel.dispatchEvent(new Event('change', { bubbles: true }));
  const dueTo = document.querySelector('[data-fkey="g1:due:to"]');
  dueTo.value = '7'; dueTo.dispatchEvent(new Event('change', { bubbles: true }));

  const shown = [...document.querySelectorAll('.list-table tbody tr[data-task]')]
    .map(tr => s.getBody(tr.dataset.task).content);

  // cleanup
  for (const c of ['近い期限タスク','古い完了タスク']){
    for (const b of s.queryBodies(x => x.content === c)){ for (const r of s.refsForBody(b.id)) s.deleteRef(r.id); }
  }
  document.getElementById('view-daily-btn').click();

  return { shown };
})()
```

Expected: `shown` includes both `'近い期限タスク'` and `'古い完了タスク'` (each matches one of the two OR'd groups), and no unrelated tasks slip in.

Do not commit yet.

---

### Task 5: Wire up `app.js`, bump version, update changelog, run full suite, commit and push

**Files:**
- Modify: `v2/src/app.js`
- Modify: `v2/CHANGELOG.md`

- [ ] **Step 1: Update `listState`'s initial shape**

In `v2/src/app.js`, find:

```js
const listState = { hideDone:false, dueFilter:'all', projFilter:'all', sort:'proj', columns: DEFAULT_COLUMNS.slice() };
```

Replace with:

```js
const listState = { sort:'proj', sortDir:'asc', columns: DEFAULT_COLUMNS.slice() };
```

(`state.groups` is created lazily by `list.js`'s `ensureGroups` on first render — same lazy-init pattern already used for `_collapsedGroups`/`_midCollapsed`/`_sel`.)

- [ ] **Step 2: Bump the version**

In `v2/src/app.js`, find:

```js
export const APP_VERSION = '0.54.0';
```

Replace with:

```js
export const APP_VERSION = '0.55.0';
```

- [ ] **Step 3: Add the changelog entry**

In `v2/CHANGELOG.md`, find the very first line:

```
# Tracker v2 — CHANGELOG
```

Replace with (keeping everything else in the file below it unchanged):

```
# Tracker v2 — CHANGELOG

## v0.55.0 — リストの検索条件を拡張（条件グループ・OR）＋完了日時の記録（2026-07-01）

- リストの絞り込みを**条件グループ（OR）**方式に刷新。各グループ内は**期限（今日から±N日の範囲）／完了状態＋完了日の範囲／プロジェクト／中項目（部分一致）／優先度**をAND条件として指定でき、**グループ間はOR**（どれか1つに一致すれば表示）。「＋OR条件を追加」で複数グループを組める。
  - 例:「直近1ヶ月に完了」OR「今後1週間が期限」を期限降順、のような条件が組めるように。
- **完了日時 `doneAt` を自動記録**（`store.updateBody` に集約・呼び出し側は無修正）。完了状態を戻すと消去。**過去に完了済みのタスクは記録が無いため、完了日での絞り込みには出てこない**（今後の完了操作から有効）。
- 並べ替えに**昇順/降順トグル**を追加（▲/▼）。プロジェクト表示（ツリー）のときは階層順を維持するため無効。
- 旧「完了を隠す」チェックボックスは廃止し、グループ内の「完了状態」に統合。既存の保存済みビュー（旧 hideDone/dueFilter/projFilter 形式）は読み込み時に自動で新形式へ変換され、そのまま使える。
- 実装: `store.js`（doneAt自動記録）、`list.js`（`selectTasks`のグループ化・`viewToGroups`マイグレーション・条件グループUI）、`style.css`。仕様書 `docs/superpowers/specs/2026-07-01-list-filter-groups.md`。
- 検証: 単体テスト（グループOR・完了日範囲・並べ替え方向・旧ビュー移行）＋ブラウザevalでUI操作と絞り込み結果を確認。
```

- [ ] **Step 4: Run the full test suite**

Run:
```bash
node v2/tests/store.core.test.mjs
node v2/tests/store.tree.test.mjs
node v2/tests/store.gc.test.mjs
node v2/tests/store.query.test.mjs
node v2/tests/store.struct.test.mjs
node v2/tests/store.views.test.mjs
node v2/tests/store.projects.test.mjs
node v2/tests/store.projectpage.test.mjs
node v2/tests/store.replace.test.mjs
node v2/tests/store.history.test.mjs
node v2/tests/store.doneat.test.mjs
node v2/tests/list.select.test.mjs
node v2/tests/clipboard.test.mjs
node v2/tests/persist.test.mjs
node v2/tests/project.mirror.test.mjs
node --check v2/src/app.js
```
Expected: every test prints its `PASS ...` line, `node --check` produces no output (success).

- [ ] **Step 5: Verify an old-format saved view still loads correctly (migration check)**

In the browser (`preview_eval`), with the app loaded:

```js
(() => {
  const s = window.__store;
  // 旧形式のビューを直接ストアに保存（saveViewはオブジェクトをそのまま保存するので旧フィールドを渡せる）
  const legacy = s.saveView({ name:'旧ビュー(next3+隠す)', hideDone:true, dueFilter:'next3', sort:'due', columns:['status','title','due'] });
  document.getElementById('view-list-btn').click();
  const sel = document.querySelector('[data-fkey="view"]');
  sel.value = legacy.id; sel.dispatchEvent(new Event('change', { bubbles: true }));
  const groupCount = document.querySelectorAll('.filter-group').length;
  const dueMode = document.querySelector('[data-fkey="g0:duemode"]').value;
  const doneMode = document.querySelector('[data-fkey="g0:donemode"]').value;
  s.deleteView(legacy.id);
  document.getElementById('view-daily-btn').click();
  return { groupCount, dueMode, doneMode };
})()
```

Expected: `{ groupCount: 1, dueMode: 'range', doneMode: 'notDone' }` — the legacy view loaded without error and converted to one group.

- [ ] **Step 6: Commit**

```bash
git add v2/src/store.js v2/tests/store.doneat.test.mjs v2/src/list.js v2/tests/list.select.test.mjs v2/style.css v2/src/app.js v2/CHANGELOG.md
git commit -m "$(cat <<'EOF'
feat(v2): list filter groups (OR of AND-conditions) + doneAt tracking (v0.55.0)

Filtering in the list view moves from three flat fields (hideDone/
dueFilter/projFilter) to an array of condition groups: each group ANDs
a due-date range (relative days from today), a done-state + done-date
range, project, mid (substring match), and priority; a task shows if it
matches ANY group (OR). Lets you express things like "done within the
last month OR due within the next week". A "+ OR condition" button adds
groups; each group beyond the first gets a delete button.

store.updateBody now auto-stamps doneAt when done flips false->true, and
clears it on true->false, so completion-date filtering works going
forward (tasks completed before this release have no doneAt and won't
match a done-date range, only "completed, any date").

Sort gains an asc/desc toggle (disabled when grouped by project, which
keeps its hierarchical order). The old "hide done" checkbox is gone,
folded into each group's done-state select. Saved views now store
groups/sortDir; old saved views (pre-existing hideDone/dueFilter/
projFilter shape) are migrated to one group on load via viewToGroups().

Spec: docs/superpowers/specs/2026-07-01-list-filter-groups.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Push (masked) to the branch and fast-forward main**

```bash
git push origin rebuild/phase1-foundation rebuild/phase1-foundation:main 2>&1 | sed -E 's#//[^@]*@#//***@#g'
git branch -f main rebuild/phase1-foundation
```
Expected: both push lines show `-> rebuild/phase1-foundation` / `-> main` with no error, remote credentials masked in the output.

---

## Self-Review Notes

- **Spec coverage:** doneAt auto-recording → Task 1. Group data model + matching + migration → Task 2. UI (group cards, add/remove, sort direction, view save/load) → Task 3. Styling → Task 4. Version/changelog/commit/push → Task 5. All six spec sections are covered.
- **No placeholders:** every step has complete, copy-pasteable code — no "add validation" or "similar to Task N" shortcuts.
- **Type/name consistency check:** `defaultGroup()`, `dueGroupMatch`, `doneGroupMatch`, `groupMatch`, `viewToGroups`, `selectTasks`, `ensureGroups`, `cloneGroups`, `buildFilterGroups`, `buildGroupCard`, `dayRangeInputs` are named identically everywhere they're defined and called across Tasks 2–3. The `data-fkey` naming scheme (`g<i>:duemode`, `g<i>:due:from`, `g<i>:due:to`, `g<i>:donemode`, `g<i>:done:from`, `g<i>:done:to`, `g<i>:proj`, `g<i>:mid`, `g<i>:prio`, `addgroup`, `sortdir`) is used consistently between the implementation (Task 3, Step 1) and the browser verification scripts (Task 4, Step 2 and Task 5, Step 5).
