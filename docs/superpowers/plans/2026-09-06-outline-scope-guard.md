# アウトライン構造操作のスコープ保証 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ズーム中・全日表示中に、編集操作でカードが可視範囲の外へ出て見えなくなる不具合（7件）を、境界判定を1箇所に集約することで塞ぐ。

**Architecture:** 構造操作（インデント／アウトデント／分割／結合／並べ替え／削除）を新規モジュール `v2/src/outline-ops.js` に純関数として集約する。すべての移動先は `wouldEscape()` を通し、可視範囲（scope）の外へ出る操作は no-op にする。`daily.js` は DOM 側の責務（`requestRender` / `focusCard`）だけを持つ。さらにズームのタイトル行には専用のキーハンドラを置き、構造変更キーを受け付けない。

**Tech Stack:** 素の ES モジュール（ビルドなし）、`node --test`、DOM 非依存の純ロジックテスト

**仕様書:** `docs/superpowers/specs/2026-09-06-outline-scope-guard-design.md`

**ベースライン:** 2026-09-06 時点で `node --test "tests/*.test.mjs"` が 43 tests / 43 pass

**仕様書からの変更点（1点）:** 仕様書の段取りでは「①ガード無しで抽出 → ③ガード追加」と2段に分けていたが、本プランでは Task 1 でガード込みの完成形を書く。理由は、Task 1 の時点では誰も `outline-ops.js` を呼ばないため挙動は一切変わらず、挙動が変わるのは結局 Task 2 以降の配線時だから。モジュールを2度書く手間に対して安全性の見返りが無い。抽出の忠実さは Task 1 の「正常系テスト」で担保する。

---

## File Structure

| ファイル | 役割 |
|---|---|
| `v2/src/outline-ops.js`（新規・約 130 行） | 構造操作の純関数とスコープ判定。DOM に触れない |
| `v2/tests/outline.ops.test.mjs`（新規） | 上記の単体テスト。正常系と境界系の両方 |
| `v2/src/daily.js`（修正） | 構造操作の実装を削除し `outline-ops` を呼ぶ。`onTitleKey` を追加 |

`daily.js` は 1556 行と大きいが、本プランでは分割しない。今回触るのはキーハンドラ周辺のみで、無関係な再構成はしない。

---

## Task 1: `outline-ops.js` とその単体テスト

**Files:**
- Create: `v2/src/outline-ops.js`
- Test: `v2/tests/outline.ops.test.mjs`

この時点では `daily.js` から呼ばない。既存の挙動は一切変わらない。

- [ ] **Step 1: テストを書く（この時点では必ず失敗する）**

`v2/tests/outline.ops.test.mjs` を新規作成:

```js
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { indent, outdent, splitCard, mergeCard, moveSibling, deleteCard,
         inScope, wouldEscape, dayRefIdOf } from '../src/outline-ops.js';

// ツリー:  day(2026-09-06) > P > A > A1
//                          > Q
function fixture(){
  const s  = createStore();
  const day = s.createCard({ kind:'day',  content:'2026-09-06' });
  const P   = s.createCard({ kind:'memo', content:'P',  parentRefId: day.ref.id });
  const A   = s.createCard({ kind:'memo', content:'A',  parentRefId: P.ref.id });
  const A1  = s.createCard({ kind:'memo', content:'A1', parentRefId: A.ref.id });
  const Q   = s.createCard({ kind:'memo', content:'Q',  parentRefId: day.ref.id });
  return { s, day, P, A, A1, Q };
}
// 日をまたぐ検査用:  d1(09-06) > X  /  d2(09-05) > Y
function twoDays(){
  const s  = createStore();
  const d1 = s.createCard({ kind:'day',  content:'2026-09-06' });
  const d2 = s.createCard({ kind:'day',  content:'2026-09-05' });
  const X  = s.createCard({ kind:'memo', content:'X', parentRefId: d1.ref.id });
  const Y  = s.createCard({ kind:'memo', content:'Y', parentRefId: d2.ref.id });
  return { s, d1, d2, X, Y };
}
const ALLDAYS = { rootRef: null };
const parentOf = (s, r) => s.getRef(r).parentRefId;

// ── スコープ判定 ──────────────────────────────
{
  const { s, day, P, A, A1 } = fixture();
  const zoom = { rootRef: P.ref.id };
  assert.equal(inScope(s, A.ref.id,  zoom), true,  'A は P の子孫なので範囲内');
  assert.equal(inScope(s, A1.ref.id, zoom), true,  'A1 も範囲内');
  assert.equal(inScope(s, P.ref.id,  zoom), true,  'ルート自身は範囲内');
  assert.equal(inScope(s, P.ref.id,  zoom, { strict:true }), false, 'strict ではルート自身を除く');
  assert.equal(dayRefIdOf(s, A1.ref.id), day.ref.id, '祖先の day を辿れる');
  assert.equal(wouldEscape(s, A.ref.id, day.ref.id, zoom), true,  'day 直下へ移すと範囲外');
  assert.equal(wouldEscape(s, A1.ref.id, P.ref.id,  zoom), false, 'ルート直下は範囲内');
}

// ── A1: ズームのルート直下からアウトデントできない ────
{
  const { s, P, A } = fixture();
  const zoom = { rootRef: P.ref.id };
  assert.equal(outdent(s, A.ref.id, zoom), false, 'ルート直下のアウトデントは no-op');
  assert.equal(parentOf(s, A.ref.id), P.ref.id, '親が変わっていない');
}

// ── 正常系（デグレ検出）: 2階層目以降は従来どおり動く ──
{
  const { s, P, A, A1 } = fixture();
  const zoom = { rootRef: P.ref.id };
  assert.equal(outdent(s, A1.ref.id, zoom), true, 'A1 はアウトデントできる');
  assert.equal(parentOf(s, A1.ref.id), P.ref.id, 'A1 の親が P になる');
  assert.equal(indent(s, A1.ref.id, zoom), true, '直前兄弟 A の下へインデントできる');
  assert.equal(parentOf(s, A1.ref.id), A.ref.id, 'A1 の親が A に戻る');
}

// ── 正常系: 全日表示でも day 直下からは出ない（既存ガードの維持）──
{
  const { s, day, P } = fixture();
  assert.equal(outdent(s, P.ref.id, ALLDAYS), false, 'day 直下は出せない');
  assert.equal(parentOf(s, P.ref.id), day.ref.id);
}

// ── A3: ルート自身は分割できない ─────────────────
{
  const { s, P } = fixture();
  const zoom = { rootRef: P.ref.id };
  assert.equal(splitCard(s, P.ref.id, 1, 'PP', zoom), null, 'ルートの分割は no-op');
  assert.equal(s.getBody(s.getRef(P.ref.id).bodyId).content, 'P', '本文が変わっていない');
}

// ── 正常系: 分割は従来どおり動く ────────────────
{
  const { s, P, A } = fixture();
  const zoom = { rootRef: P.ref.id };
  const r1 = splitCard(s, A.ref.id, 1, 'AB', zoom);   // 行末でない → 前半を上に切り出す
  assert.ok(r1, '分割が成立する');
  assert.deepEqual(s.childRefs(P.ref.id).map(x => s.getBody(x.bodyId).content), ['A', 'B'],
                   '前半 A が上、後半 B が元カードに残る');
  assert.equal(r1.focusRefId, A.ref.id, 'フォーカスは元カード');
  assert.equal(r1.focusPos, 0);
}
{
  const { s, P, A } = fixture();
  const zoom = { rootRef: P.ref.id };
  const r2 = splitCard(s, A.ref.id, 1, 'A', zoom);    // 行末 → 下に空カードを作る
  assert.ok(r2);
  assert.deepEqual(s.childRefs(P.ref.id).map(x => s.getBody(x.bodyId).content), ['A', ''],
                   '下に空カードができる');
  assert.equal(r2.focusPos, 0);
}

// ── B2: ルート自身は削除できない ─────────────────
{
  const { s, P } = fixture();
  const zoom = { rootRef: P.ref.id };
  assert.equal(deleteCard(s, P.ref.id, zoom), false, 'ルートの削除は no-op');
  assert.ok(s.getRef(P.ref.id), 'P がまだ存在する');
}

// ── B3: ルートへは結合できない ──────────────────
{
  const { s, P, A } = fixture();
  const zoom = { rootRef: P.ref.id };
  assert.equal(mergeCard(s, A.ref.id, P.ref.id, 'A', zoom), null, 'ルートへの結合は no-op');
  assert.ok(s.getRef(A.ref.id), 'A がまだ存在する');
  assert.equal(s.getBody(s.getRef(P.ref.id).bodyId).content, 'P', 'ルートの本文が汚れていない');
}

// ── B1: 日をまたぐ結合はできない ────────────────
{
  const { s, X, Y } = twoDays();
  assert.equal(mergeCard(s, Y.ref.id, X.ref.id, 'Y', ALLDAYS), null, '別の日へは結合しない');
  assert.ok(s.getRef(Y.ref.id), 'Y がまだ存在する');
  assert.equal(s.getBody(s.getRef(X.ref.id).bodyId).content, 'X', 'X の本文が汚れていない');
}

// ── 正常系: 同じ日の中の結合は従来どおり動く ──────────
{
  const { s, day, P, Q, A } = fixture();
  const r = mergeCard(s, Q.ref.id, P.ref.id, 'Q', ALLDAYS);
  assert.ok(r, '同じ日なら結合できる');
  assert.equal(s.getBody(s.getRef(P.ref.id).bodyId).content, 'PQ', '本文が連結される');
  assert.equal(r.focusRefId, P.ref.id);
  assert.equal(r.focusPos, 1, 'caret は連結位置');
  assert.equal(s.getRef(Q.ref.id), undefined, 'Q は削除される');
  assert.equal(parentOf(s, A.ref.id), P.ref.id, 'P の既存の子は保たれる');
  assert.equal(s.childRefs(day.ref.id).length, 1, 'day 直下は P のみ');
}

// ── 表・画像へは結合しない（既存挙動の維持）──────────
{
  const s = createStore();
  const day = s.createCard({ kind:'day', content:'2026-09-06' });
  const img = s.createCard({ kind:'image', content:'v2-data/img/a.png', parentRefId: day.ref.id });
  const m   = s.createCard({ kind:'memo',  content:'M', parentRefId: day.ref.id });
  assert.equal(mergeCard(s, m.ref.id, img.ref.id, 'M', ALLDAYS), null, '画像へは結合しない');
  assert.ok(s.getRef(m.ref.id), 'M が残る');
}

// ── 並べ替え: ルート自身は動かない／兄弟内では動く ──────
{
  const { s, day, P, Q } = fixture();
  const zoom = { rootRef: P.ref.id };
  assert.equal(moveSibling(s, P.ref.id, -1, zoom), false, 'ルートは並べ替えない');
  assert.equal(moveSibling(s, Q.ref.id, -1, ALLDAYS), true, 'Q を上へ');
  assert.deepEqual(s.childRefs(day.ref.id).map(x => s.getBody(x.bodyId).content), ['Q', 'P']);
  assert.equal(moveSibling(s, Q.ref.id, -1, ALLDAYS), false, '先頭より上へは動かない');
}

// ── 削除: 子ごと消える（既存挙動の維持）────────────
{
  const { s, P, A, A1 } = fixture();
  const zoom = { rootRef: P.ref.id };
  assert.equal(deleteCard(s, A.ref.id, zoom), true);
  assert.equal(s.getRef(A.ref.id), undefined, 'A が消える');
  assert.equal(s.getRef(A1.ref.id), undefined, '子 A1 も連鎖削除される');
}

console.log('PASS outline.ops');
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run:
```bash
cd v2 && node --test "tests/outline.ops.test.mjs"
```
Expected: FAIL — `Cannot find module ... src/outline-ops.js`

- [ ] **Step 3: `v2/src/outline-ops.js` を実装する**

```js
// アウトラインの構造操作（インデント/アウトデント/分割/結合/並べ替え/削除）を集約する。
// DOM に触れない純ロジック。呼び出し側が requestRender() と focusCard() を行う。
//
// なぜ集約するか: 以前は同じ処理が daily.js の2箇所（テキストカード用とブロック用）に
// コピーされ、可視範囲から出さないためのガードが片方にしか無かった。その結果、
// ズーム中にアウトデントするとカードが画面から消える不具合が生じていた。
// 移動先の判定は必ず wouldEscape() を通す。各操作が個別に境界を判断してはならない。
//
// scope = { rootRef: string|null }
//   rootRef 非null … ズーム/プロジェクトページ。境界 = rootRef のサブツリー
//   rootRef null   … 全日表示。境界 = それぞれの day カードのサブツリー

// refId の祖先 ref.id を根まで列挙する（自分自身は含まない）
export function ancestorRefIds(store, refId){
  const out = [];
  let r = store.getRef(refId);
  while (r && r.parentRefId){ out.push(r.parentRefId); r = store.getRef(r.parentRefId); }
  return out;
}

// refId が属する day カードの ref.id（見つからなければ null）
export function dayRefIdOf(store, refId){
  let cur = refId;
  while (cur){
    const r = store.getRef(cur); if (!r) return null;
    const b = store.getBody(r.bodyId);
    if (b && b.kind === 'day') return r.id;
    cur = r.parentRefId;
  }
  return null;
}

// refId が scope の内側にあるか。strict=true はルート自身を除く（ページの見出しは編集対象外）
export function inScope(store, refId, scope, { strict = false } = {}){
  const root = scope && scope.rootRef;
  if (root){
    if (refId === root) return !strict;
    return ancestorRefIds(store, refId).includes(root);
  }
  return dayRefIdOf(store, refId) !== null;
}

// refId を newParentRefId の下へ移したとき、scope の外へ出るか
export function wouldEscape(store, refId, newParentRefId, scope){
  if (newParentRefId == null) return true;
  const root = scope && scope.rootRef;
  if (root){
    if (newParentRefId === root) return false;
    return !ancestorRefIds(store, newParentRefId).includes(root);
  }
  const from = dayRefIdOf(store, refId);
  const to   = dayRefIdOf(store, newParentRefId);
  return !from || from !== to;
}

// refId と targetRefId が同じ境界の中にあるか（結合の可否判定に使う）
export function sameScopeUnit(store, refId, targetRefId, scope){
  const root = scope && scope.rootRef;
  if (root){
    return inScope(store, refId, scope, { strict:true })
        && inScope(store, targetRefId, scope, { strict:true });
  }
  const a = dayRefIdOf(store, refId), b = dayRefIdOf(store, targetRefId);
  return !!a && a === b;
}

const isRoot = (refId, scope) => !!(scope && scope.rootRef) && refId === scope.rootRef;

// Tab: 直前の兄弟の子にする
export function indent(store, refId, scope){
  if (!refId || isRoot(refId, scope)) return false;
  const prev = store.prevSiblingRef(refId);
  if (!prev) return false;
  if (wouldEscape(store, refId, prev.id, scope)) return false;
  store.updateRef(refId, { parentRefId: prev.id, order: store.endOrder(prev.id) });
  return true;
}

// Shift+Tab: 親の直後の兄弟にする
export function outdent(store, refId, scope){
  if (!refId || isRoot(refId, scope)) return false;
  const ref = store.getRef(refId);
  if (!ref || !ref.parentRefId) return false;
  const parentRef = store.getRef(ref.parentRefId);
  if (!parentRef) return false;
  const pb = store.getBody(parentRef.bodyId);
  if (pb && pb.kind === 'day') return false;              // day 直下からは出さない
  if (wouldEscape(store, refId, parentRef.parentRefId, scope)) return false;
  store.updateRef(refId, { parentRefId: parentRef.parentRefId, order: store.orderAfter(parentRef.id) });
  return true;
}

// Alt+Shift+↑↓: 兄弟内で並べ替える（dir: -1 上 / +1 下）
export function moveSibling(store, refId, dir, scope){
  if (!refId || isRoot(refId, scope)) return false;
  const sibs = store.siblings(refId);
  const i = sibs.findIndex(x => x.id === refId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return false;
  const oi = sibs[i].order, oj = sibs[j].order;   // 更新で参照が変わるため先に退避
  store.updateRef(sibs[i].id, { order: oj });
  store.updateRef(sibs[j].id, { order: oi });
  return true;
}

// Enter: カーソル位置で分割する。text/pos は呼び出し側（DOM）が渡す。
// 戻り値 { focusRefId, focusPos } … 呼び出し側はこれで focusCard する
export function splitCard(store, refId, pos, text, scope){
  if (!refId || isRoot(refId, scope)) return null;
  const ref = store.getRef(refId); if (!ref) return null;
  const body = store.getBody(ref.bodyId); if (!body) return null;
  if (wouldEscape(store, refId, ref.parentRefId, scope)) return null;
  const prefix = text.slice(0, pos), suffix = text.slice(pos);
  if (!suffix){                                  // 行末: 下に空カードを作りそこへ移る
    store.updateBody(body.id, { content: prefix });
    const created = store.createCard({
      kind: body.kind, content: '', proj: body.proj,
      parentRefId: ref.parentRefId, order: store.orderAfter(ref.id),
    });
    return { focusRefId: created.ref.id, focusPos: 0 };
  }
  // 行頭/行中: 前半を直前に切り出し、後半と子は元カードに残す（Workflowy 風）
  store.updateBody(body.id, { content: suffix });
  store.createCard({
    kind: body.kind, content: prefix, proj: body.proj, mid: body.mid,
    parentRefId: ref.parentRefId, order: store.orderBefore(ref.id),
  });
  return { focusRefId: ref.id, focusPos: 0 };
}

// 行頭 Backspace: targetRefId（直前の可視カード）へ結合する
export function mergeCard(store, refId, targetRefId, text, scope){
  if (!refId || !targetRefId || isRoot(refId, scope)) return null;
  if (!sameScopeUnit(store, refId, targetRefId, scope)) return null;
  const targetRef = store.getRef(targetRefId); if (!targetRef) return null;
  const targetBody = store.getBody(targetRef.bodyId); if (!targetBody) return null;
  if (targetBody.kind === 'table' || targetBody.kind === 'image') return null;   // 表/画像へは結合しない
  const mergePos = (targetBody.content || '').length;
  store.updateBody(targetBody.id, { content: (targetBody.content || '') + text });
  for (const child of store.childRefs(refId)){
    store.updateRef(child.id, { parentRefId: targetRefId, order: store.endOrder(targetRefId) });
  }
  store.deleteRef(refId);
  return { focusRefId: targetRefId, focusPos: mergePos };
}

// Ctrl+Shift+Backspace: 子ごと削除する
export function deleteCard(store, refId, scope){
  if (!refId || isRoot(refId, scope)) return false;
  if (!inScope(store, refId, scope, { strict:true })) return false;
  store.deleteRef(refId);
  return true;
}
```

- [ ] **Step 4: テストを走らせて通ることを確認する**

Run:
```bash
cd v2 && node --test "tests/outline.ops.test.mjs"
```
Expected: PASS — `PASS outline.ops` が出力され、`fail 0`

- [ ] **Step 5: 全テストを走らせて既存が壊れていないことを確認する**

Run:
```bash
cd v2 && node --test "tests/*.test.mjs"
```
Expected: `pass 44` / `fail 0`（既存 43 + 新規 1）

- [ ] **Step 6: commit / push**

```bash
git add v2/src/outline-ops.js v2/tests/outline.ops.test.mjs
git commit -F - <<'EOF'
feat(v2): アウトラインの構造操作を outline-ops.js に集約する

インデント/アウトデント/分割/結合/並べ替え/削除を純関数にまとめ、
移動先が可視範囲の外へ出る場合は何もしないようにした。
この時点ではまだ daily.js から呼んでいないので挙動は変わらない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin main
```

---

## Task 2: インデント／アウトデントを差し替える（C1 の解消・A1・A2 の修正）

**Files:**
- Modify: `v2/src/daily.js` — import 追加、`currentScope()` 追加、`onKey` の Tab 分岐（1005-1030 付近）、`onBlockKey` の Tab 分岐（1267-1281 付近）

重複していた2箇所が同じ関数を呼ぶようになる。

- [ ] **Step 1: import と `currentScope()` を追加する**

`daily.js:11`（`const { projColor } = await import('./colors.js' + _q);`）の直後に追加する。`_q` はキャッシュ回避クエリで、`daily.js:9` に既にある:

```js
const { indent, outdent, splitCard, mergeCard, moveSibling, deleteCard } =
  await import('./outline-ops.js' + _q);
```

`currentScope()` は `visibleFlat`（1534 行）の直前に置く:

```js
// 現在の可視範囲。ズーム/PJページなら rootRef、全日表示なら null（境界は day）
function currentScope(){ return { rootRef: _ctx.rootRef || null }; }
```

- [ ] **Step 2: `onKey` の Tab 分岐を差し替える**

`daily.js:1005` から始まるブロックのうち、`e.preventDefault();`（1015 行）以降の

```js
    e.preventDefault();
    if (ref.id === _ctx.rootRef) return;   // ズーム/ページのタイトル（ルート）はインデント・アウトデントしない
    if (e.shiftKey){
      const parentRef = store.getRef(ref.parentRefId);
      if (!parentRef) return;
      if (store.getBody(parentRef.bodyId)?.kind === 'day') return;
      store.updateRef(ref.id, { parentRefId: parentRef.parentRefId, order: store.orderAfter(parentRef.id) });
    } else {
      const prev = store.prevSiblingRef(ref.id);
      if (!prev) return;
      store.updateRef(ref.id, { parentRefId: prev.id, order: store.endOrder(prev.id) });
    }
    requestRender();
    focusCard(ref.id, pos);
    return;
```

を、次に置き換える（その上にある `_openMenu` と `mirrorRoot` のガード3行はそのまま残す）:

```js
    e.preventDefault();
    const ok = e.shiftKey ? outdent(store, ref.id, currentScope())
                          : indent(store, ref.id, currentScope());
    if (ok){ requestRender(); focusCard(ref.id, pos); }
    return;
```

- [ ] **Step 3: `onBlockKey` の Tab 分岐を差し替える**

`daily.js:1267` から始まるブロックのうち

```js
    if (e.shiftKey){
      const parentRef = store.getRef(ref.parentRefId); if (!parentRef) return;
      if (store.getBody(parentRef.bodyId)?.kind === 'day') return;
      store.updateRef(ref.id, { parentRefId: parentRef.parentRefId, order: store.orderAfter(parentRef.id) });
    } else {
      const prev = store.prevSiblingRef(ref.id); if (!prev) return;
      store.updateRef(ref.id, { parentRefId: prev.id, order: store.endOrder(prev.id) });
    }
    requestRender(); focusCard(ref.id); return;
```

を、次に置き換える（その上の `mirrorRoot` ガード2行はそのまま残す）:

```js
    const ok = e.shiftKey ? outdent(store, ref.id, currentScope())
                          : indent(store, ref.id, currentScope());
    if (ok){ requestRender(); focusCard(ref.id); }
    return;
```

- [ ] **Step 4: 全テストを走らせる**

Run:
```bash
cd v2 && node --test "tests/*.test.mjs"
```
Expected: `pass 44` / `fail 0`

- [ ] **Step 5: 構文エラーが無いことを確認する**

Run:
```bash
cd v2 && node --input-type=module -e "await import('./src/outline-ops.js'); console.log('outline-ops OK')"
```
Expected: `outline-ops OK`

- [ ] **Step 6: commit / push**

```bash
git add v2/src/daily.js
git commit -F - <<'EOF'
fix(v2): ズーム中にアウトデントするとカードが消えるのを直す

インデント/アウトデントの処理がテキストカード用とブロック用の2箇所に
コピーされていて、可視範囲から出さないガードが片方にしか無かった。
両方を outline-ops.js の同じ関数に寄せた。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin main
```

---

## Task 3: 分割（Enter）を差し替える（A3 の ops 層修正）

**Files:**
- Modify: `v2/src/daily.js` — `onKey` の `if (e.key === 'Enter')` 分岐（985-1004 付近）

- [ ] **Step 1: Enter 分岐を差し替える**

`daily.js:985` から始まる

```js
  if (e.key === 'Enter'){
    e.preventDefault();
    const prefix = text.slice(0, pos), suffix = text.slice(pos);
    if (!suffix){                                          // 行末: 従来どおり下に空ノードを作りそこへ（新規入力の継続）
      store.updateBody(body.id, { content: prefix });
      const created = store.createCard({
        kind: body.kind, content: '', proj: body.proj,
        parentRefId: ref.parentRefId, order: store.orderAfter(ref.id),
      });
      requestRender();
      focusCard(created.ref.id, 0);
    } else {                                               // 行頭/行中: カーソル前で新ノードを直前に作り、カーソル以降＋リンク/子は元ノードに残して下へ（Workflowy風）
      store.updateBody(body.id, { content: suffix });
      store.createCard({
        kind: body.kind, content: prefix, proj: body.proj, mid: body.mid,
        parentRefId: ref.parentRefId, order: store.orderBefore(ref.id),
      });
      requestRender();
      focusCard(ref.id, 0);
    }
    return;
  }
```

を、次に置き換える:

```js
  if (e.key === 'Enter'){
    e.preventDefault();
    const r = splitCard(store, ref.id, pos, text, currentScope());
    if (r){ requestRender(); focusCard(r.focusRefId, r.focusPos); }
    return;
  }
```

- [ ] **Step 2: 全テストを走らせる**

Run:
```bash
cd v2 && node --test "tests/*.test.mjs"
```
Expected: `pass 44` / `fail 0`

- [ ] **Step 3: commit / push**

```bash
git add v2/src/daily.js
git commit -F - <<'EOF'
fix(v2): ズームのタイトルで Enter を押すと前半が範囲外へ飛ぶのを直す

分割処理を outline-ops.js の splitCard に寄せた。ページの見出し自体は
分割しない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin main
```

---

## Task 4: 結合（行頭 Backspace）を差し替える（B1・B3 の修正）

**Files:**
- Modify: `v2/src/daily.js` — `onKey` の `Backspace && pos === 0` 分岐（1043-1060 付近）

- [ ] **Step 1: Backspace 結合の分岐を差し替える**

`daily.js:1043` から始まる

```js
  if (e.key === 'Backspace' && pos === 0 && window.getSelection().isCollapsed){
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    if (idx <= 0) return;
    const prevRefId = flat[idx - 1];
    const prevBody = store.getBody(store.getRef(prevRefId).bodyId);
    if (prevBody.kind === 'table' || prevBody.kind === 'image') return;   // 表/画像へは結合しない
    e.preventDefault();
    const mergePos = (prevBody.content || '').length;
    store.updateBody(prevBody.id, { content: (prevBody.content || '') + text });
    for (const child of store.childRefs(ref.id)){
      store.updateRef(child.id, { parentRefId: prevRefId, order: store.endOrder(prevRefId) });
    }
    store.deleteRef(ref.id);
    requestRender();
    focusCard(prevRefId, mergePos);
    return;
  }
```

を、次に置き換える:

```js
  if (e.key === 'Backspace' && pos === 0 && window.getSelection().isCollapsed){
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    if (idx <= 0) return;
    const r = mergeCard(store, ref.id, flat[idx - 1], text, currentScope());
    if (!r) return;                 // 境界越え・表/画像への結合は既定動作に任せる（何も起きない）
    e.preventDefault();
    requestRender();
    focusCard(r.focusRefId, r.focusPos);
    return;
  }
```

`e.preventDefault()` は結合が成立したときだけ呼ぶ。先に呼ぶと、結合しない場合に Backspace が握り潰されて文字も消せなくなる。

- [ ] **Step 2: 全テストを走らせる**

Run:
```bash
cd v2 && node --test "tests/*.test.mjs"
```
Expected: `pass 44` / `fail 0`

- [ ] **Step 3: commit / push**

```bash
git add v2/src/daily.js
git commit -F - <<'EOF'
fix(v2): 行頭 Backspace が別の日やページ見出しへ結合するのを直す

全日表示では日をまたいだ結合を、ズーム中はページ見出しへの吸い込みを
それぞれ止めた。結合しないときは Backspace の既定動作を奪わない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin main
```

---

## Task 5: 並べ替えと削除を差し替える（B2 の ops 層修正）

**Files:**
- Modify: `v2/src/daily.js` — `Ctrl+Shift+Backspace` 分岐（1032-1042 付近）、`Alt+Shift+↑↓` 分岐（1061-1075 付近）、`onBlockKey` の `Alt+Shift+↑↓` 分岐（1283-1292 付近）

- [ ] **Step 1: 削除の分岐を差し替える**

`daily.js:1032` から始まる

```js
  if (e.key === 'Backspace' && e.shiftKey && (e.ctrlKey || e.metaKey)){
    e.preventDefault();
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    if (store.childRefs(ref.id).length && !confirm('子を含めて削除しますか？')) return;
    store.deleteRef(ref.id);
    requestRender();
    const target = flat[idx - 1] || flat[idx + 1];
    if (target) focusCard(target, -1);
    return;
  }
```

を、次に置き換える:

```js
  if (e.key === 'Backspace' && e.shiftKey && (e.ctrlKey || e.metaKey)){
    e.preventDefault();
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    if (store.childRefs(ref.id).length && !confirm('子を含めて削除しますか？')) return;
    if (!deleteCard(store, ref.id, currentScope())) return;   // ページの見出し自体は消さない
    requestRender();
    const target = flat[idx - 1] || flat[idx + 1];
    if (target && store.getRef(target)) focusCard(target, -1);
    return;
  }
```

- [ ] **Step 2: 並べ替えの分岐を差し替える（`onKey` 側）**

`daily.js:1061` から始まる

```js
  if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){
    e.preventDefault();                              // 兄弟内で上下に並べ替え
    const _mr = el.closest && el.closest('.card-row');
    if (_mr && _mr.dataset.mirrorRoot) return;       // ミラーのタイトル行は移動しない（見えない実兄弟を動かさない）
    const sibs = store.siblings(ref.id);
    const i = sibs.findIndex(x => x.id === ref.id);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (j < 0 || j >= sibs.length) return;
    const oi = sibs[i].order, oj = sibs[j].order;   // 入れ替え前に値を退避（更新で参照が変わるため）
    store.updateRef(sibs[i].id, { order: oj });
    store.updateRef(sibs[j].id, { order: oi });
    requestRender();
    focusCard(ref.id, pos);
    return;
  }
```

を、次に置き換える:

```js
  if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){
    e.preventDefault();                              // 兄弟内で上下に並べ替え
    const _mr = el.closest && el.closest('.card-row');
    if (_mr && _mr.dataset.mirrorRoot) return;       // ミラーのタイトル行は移動しない（見えない実兄弟を動かさない）
    if (moveSibling(store, ref.id, e.key === 'ArrowUp' ? -1 : 1, currentScope())){
      requestRender(); focusCard(ref.id, pos);
    }
    return;
  }
```

- [ ] **Step 3: 並べ替えの分岐を差し替える（`onBlockKey` 側）**

`daily.js:1283` から始まる

```js
  if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){   // 兄弟内で上下移動
    e.preventDefault();
    const _mr = e.currentTarget.closest && e.currentTarget.closest('.card-row');
    if (_mr && _mr.dataset.mirrorRoot) return;       // ミラーのタイトル行（ブロック）は移動しない
    const sibs = store.siblings(ref.id); const i = sibs.findIndex(x => x.id === ref.id);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1; if (j < 0 || j >= sibs.length) return;
    const oi = sibs[i].order, oj = sibs[j].order;
    store.updateRef(sibs[i].id, { order: oj }); store.updateRef(sibs[j].id, { order: oi });
    requestRender(); focusCard(ref.id); return;
  }
```

を、次に置き換える:

```js
  if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){   // 兄弟内で上下移動
    e.preventDefault();
    const _mr = e.currentTarget.closest && e.currentTarget.closest('.card-row');
    if (_mr && _mr.dataset.mirrorRoot) return;       // ミラーのタイトル行（ブロック）は移動しない
    if (moveSibling(store, ref.id, e.key === 'ArrowUp' ? -1 : 1, currentScope())){
      requestRender(); focusCard(ref.id);
    }
    return;
  }
```

- [ ] **Step 4: 全テストを走らせる**

Run:
```bash
cd v2 && node --test "tests/*.test.mjs"
```
Expected: `pass 44` / `fail 0`

- [ ] **Step 5: 構造操作の直書きが残っていないことを確認する**

Run:
```bash
cd v2 && grep -n "parentRefId: parentRef.parentRefId\|parentRefId: prev.id" src/daily.js
```
Expected: 出力なし（すべて `outline-ops.js` へ移った）

- [ ] **Step 6: commit / push**

```bash
git add v2/src/daily.js
git commit -F - <<'EOF'
fix(v2): ズームのタイトルでページごと削除できてしまうのを直す

削除と並べ替えも outline-ops.js に寄せた。これで daily.js から
構造を直接書き換える箇所が無くなった。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin main
```

---

## Task 6: ズームタイトル専用のキーハンドラ（C2 の解消）

**Files:**
- Modify: `v2/src/daily.js` — `onTitleKey` / `isTitleAllowedKey` を追加、`renderOutlinePage` の 815 行を差し替え
- Create: `v2/tests/daily.titlekey.test.mjs`

ops 層で既に塞がっているが、タイトルに意味のない操作を見せない。層が2つになり、将来ハンドラを足したときの取りこぼしにも耐える。

テストは `outline.ops.test.mjs` に足さず別ファイルにする。`outline-ops.js` は DOM 非依存のままにしておきたいので、`daily.js` への依存を持ち込まない。

- [ ] **Step 1: `isTitleAllowedKey` のテストを書く**

`v2/tests/daily.titlekey.test.mjs` を新規作成:

```js
import assert from 'node:assert/strict';
import { isTitleAllowedKey } from '../src/daily.js';

// ズーム/PJページの見出し行で受け付けるキーの判定。
// 見出しはカードではないので、構造を変えるキーは通さない。
{
  const K = (key, mod = {}) => ({ key, altKey:false, ctrlKey:false, metaKey:false, shiftKey:false, ...mod });
  // 許可: ナビとコンテンツ挿入
  assert.equal(isTitleAllowedKey(K('ArrowUp',   { altKey:true })), true,  'Alt+↑ でズームを出る');
  assert.equal(isTitleAllowedKey(K('/',         { ctrlKey:true })), true, 'Ctrl+/ で日付挿入');
  assert.equal(isTitleAllowedKey(K('@')),         true, '@ でメンション');
  assert.equal(isTitleAllowedKey(K('#')),         true, '# でタグ');
  assert.equal(isTitleAllowedKey(K('ArrowDown')), true, '↓ で子カードへ');
  assert.equal(isTitleAllowedKey(K('ArrowLeft')), true, '← でチップ移動');
  assert.equal(isTitleAllowedKey(K('Escape')),    true, 'Esc');
  // 拒否: 構造を変えるもの
  assert.equal(isTitleAllowedKey(K('Enter')),     false, 'Enter は分割しない');
  assert.equal(isTitleAllowedKey(K('Enter', { ctrlKey:true })),  false, 'Ctrl+Enter でタスク化しない');
  assert.equal(isTitleAllowedKey(K('Tab')),       false, 'Tab はインデントしない');
  assert.equal(isTitleAllowedKey(K('Tab', { shiftKey:true })),   false, 'Shift+Tab もしない');
  assert.equal(isTitleAllowedKey(K('Backspace', { shiftKey:true, ctrlKey:true })), false, 'ページを削除しない');
  assert.equal(isTitleAllowedKey(K('ArrowUp', { altKey:true, shiftKey:true })),    false, '並べ替えない');
  assert.equal(isTitleAllowedKey(K('ArrowUp', { ctrlKey:true })), false, 'カスケード開閉しない');
}

console.log('PASS daily.titlekey');
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run:
```bash
cd v2 && node --test "tests/daily.titlekey.test.mjs"
```
Expected: FAIL — `isTitleAllowedKey is not a function`

- [ ] **Step 3: `isTitleAllowedKey` と `onTitleKey` を実装する**

`daily.js` の `renderOutlinePage`（797 行）の直前に追加:

```js
// ── ズーム/PJページのタイトル行 ──────────────────────────────────
// タイトルはカードではなくページの見出しなので、構造を変えるキーは受け付けない。
// 以前はここに onKey をそのまま繋いでいたため、Enter で見出しの前半が
// 可視範囲の外へ飛んだり、Ctrl+Shift+Backspace で開いているページごと消えたりした。
// 許可するキーはこの配列だけ。増やすときは1行足す。
const TITLE_ALLOWED = [
  (e) => e.altKey && !e.shiftKey && e.key === 'ArrowUp',                            // ズームを出る
  (e) => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === '/',     // 日付挿入
  (e) => e.key === '@' && !e.ctrlKey && !e.metaKey,                                 // メンション
  (e) => e.key === '#' && !e.ctrlKey && !e.metaKey && !e.altKey,                    // タグ
  (e) => (e.key === 'ArrowUp' || e.key === 'ArrowDown')
         && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey,                   // 子カードとの往復
  (e) => (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
         && !e.altKey && !e.ctrlKey && !e.metaKey,                                  // メンションチップの前後
  (e) => e.key === 'Escape',
];
export function isTitleAllowedKey(e){ return TITLE_ALLOWED.some(fn => fn(e)); }

function onTitleKey(e, store, ref, body, requestRender){
  if (e.isComposing || e.keyCode === 229) return;      // IME変換中は素通り（変換確定の Enter を奪わない）
  if (isTitleAllowedKey(e)){ onKey(e, store, ref, body, requestRender); return; }
  if (e.key === 'Enter' || e.key === 'Tab') e.preventDefault();   // 改行・フォーカス移動の既定動作も抑止
  // それ以外（文字入力、Backspace/Delete による文字削除）はブラウザ既定に任せる。
  // input リスナが本体へ保存する。
}
```

- [ ] **Step 4: `renderOutlinePage` の接続を差し替える**

`daily.js:815` の

```js
  tt.addEventListener('keydown', (e) => onKey(e, store, fref, fbody, requestRender));   // タイトルからも Alt+↑ で出る等
```

を、次に置き換える:

```js
  tt.addEventListener('keydown', (e) => onTitleKey(e, store, fref, fbody, requestRender));   // 見出しは構造を変えない
```

- [ ] **Step 5: 全テストを走らせる**

Run:
```bash
cd v2 && node --test "tests/*.test.mjs"
```
Expected: `pass 45` / `fail 0`（既存 43 + outline.ops + daily.titlekey）

- [ ] **Step 6: onKey への直接接続が残っていないことを確認する**

Run:
```bash
cd v2 && grep -n "zoom-title-txt" -A 3 src/daily.js | grep "onKey"
```
Expected: 出力なし

- [ ] **Step 7: commit / push**

```bash
git add v2/src/daily.js v2/tests/daily.titlekey.test.mjs
git commit -F - <<'EOF'
fix(v2): ページ見出しでカード用のキー操作が全部効いてしまうのを直す

見出しには専用のハンドラを置き、受け付けるキーを許可リストで絞った。
IME変換中は素通りさせるので、日本語入力の確定 Enter は奪わない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin main
```

---

## Task 7: 実機での手動確認

**Files:** なし（確認のみ）

自動テストは DOM を持たないため、実際のキー入力での確認を行う。

- [ ] **Step 1: ローカルサーバを起動する**

`.claude/launch.json` に v2 用の設定が無ければ作成する:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "tracker-v2", "runtimeExecutable": "npx", "runtimeArgs": ["-y", "serve", "-l", "8080", "v2"], "port": 8080 }
  ]
}
```

Browser pane の `preview_start` で `{ name: "tracker-v2" }` を起動する。Bash では起動しない。

- [ ] **Step 2: 修正した7件を再現操作で確認する**

いずれも **カードが画面から消えないこと** を確認する。

| ID | 操作 | 期待 |
|---|---|---|
| A1 | カードにズーム（`Alt+↓`）し、ルート直下のカードで `Shift+Tab` | 何も起きない。カードはその場に残る |
| A2 | 同じ状態で、画像または表のブロックを選び `Shift+Tab` | 何も起きない |
| A3 | ズームのタイトル行の途中にカーソルを置き `Enter` | 何も起きない。タイトルの文字が減らない |
| B1 | 全日表示で、ある日の先頭カードの行頭で `Backspace` | 前の日のカードに結合されない |
| B2 | ズームのタイトル行で `Ctrl+Shift+Backspace` | ページが消えない |
| B3 | ズームのルート直下・先頭カードの行頭で `Backspace` | タイトルに文字が吸い込まれない |
| C2 | ズームのタイトル行で `Ctrl+Enter` | チェックボックスが付かない（タスク化しない） |

- [ ] **Step 3: デグレしていないことを確認する（正常系）**

| 操作 | 期待 |
|---|---|
| ズーム内の2階層目のカードで `Shift+Tab` | 1つ浅くなる。画面に残る |
| ズーム内で `Tab` | 直前の兄弟の子になる |
| 日本語を入力して変換中に `Enter` | 変換が確定するだけ。カードは分割されない |
| カード末尾で `Enter` | 下に新しいカードができ、そこへカーソルが移る |
| カード途中で `Enter` | 前半が上のカードになり、後半が残る |
| 同じ日の中で行頭 `Backspace` | 直前のカードに結合され、caret が連結位置に来る |
| `Alt+Shift+↑↓` | 兄弟内で上下に動く |
| ズームのタイトルで `↓` | 最初の子カードへ移動する |
| ズームのタイトルで `Alt+↑` | 1つ上のズームへ戻る |
| ズームのタイトルで `Backspace` | 普通に文字が消える |
| プロジェクトページでも上記が同じ | ビューによらず同じ挙動 |
| 分割ビュー（⊟）でも上記が同じ | ペインによらず同じ挙動 |

- [ ] **Step 4: 気づいた点を記録する**

想定と違う挙動があれば、この時点で報告する。修正を重ねる前に、まず何が起きたかを共有する。

---

## Self-Review メモ

- 仕様書の不具合 A1・A2・A3・B1・B2・B3・C1・C2 は、それぞれ Task 2・2・3・4・5・4・2・6 で対応済み。
- 仕様書「スコープ外」に挙げた `persist.js` の2件と到達性の問題には、本プランでは一切触れない。
- Task 1 で定義した関数名（`indent` / `outdent` / `splitCard` / `mergeCard` / `moveSibling` / `deleteCard` / `inScope` / `wouldEscape` / `sameScopeUnit` / `dayRefIdOf` / `ancestorRefIds`）は Task 2 以降の呼び出しと一致している。
- `splitCard` / `mergeCard` の戻り値は `{ focusRefId, focusPos }` で統一。`indent` / `outdent` / `moveSibling` / `deleteCard` は boolean。
