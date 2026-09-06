import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { indent, outdent, splitCard, mergeCard, moveSibling, deleteCard,
         inScope, wouldEscape, dayRefIdOf, deletableRoots } from '../src/outline-ops.js';

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

// ── wouldEscape: 全日表示では日をまたぐ移動を弾く ──────
// 現在の indent/outdent/splitCard からは到達しないが、この関数が
// 境界判定の唯一の窓口なので、全日表示側の分岐も直接検証しておく。
{
  const { s, d1, d2, X, Y } = twoDays();
  assert.equal(wouldEscape(s, X.ref.id, d1.ref.id, ALLDAYS), false, '同じ日の中は範囲内');
  assert.equal(wouldEscape(s, X.ref.id, d2.ref.id, ALLDAYS), true,  '別の日へ移すと範囲外');
  assert.equal(wouldEscape(s, X.ref.id, Y.ref.id,  ALLDAYS), true,  '別の日のカードの下も範囲外');
  assert.equal(wouldEscape(s, X.ref.id, null,      ALLDAYS), true,  '親なしは範囲外');
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

// ── 全日表示では day カード自身を消せない ────────────
{
  const { s, day, P } = fixture();
  assert.equal(inScope(s, day.ref.id, ALLDAYS, { strict:true }), false, 'day 自身は strict の外');
  assert.equal(deleteCard(s, day.ref.id, ALLDAYS), false, 'day カードの削除は no-op');
  assert.ok(s.getRef(day.ref.id), 'day がまだ存在する');
  assert.equal(deleteCard(s, P.ref.id, ALLDAYS), true, '日の中のカードは削除できる');
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

// ── 複数選択の削除: 境界のルートが混ざっていても消さない ────
// ズーム中は visibleFlat の先頭がルート自身なので、Shift+↑ でルートまで
// 選択できてしまう。その状態の Delete でページごと消えないようにする。
{
  const { s, P, A, A1, Q } = fixture();
  const zoom = { rootRef: P.ref.id };
  // ルートが混ざっていても、ルートは削除対象に入らない
  assert.deepEqual(deletableRoots(s, [P.ref.id, A.ref.id], zoom), [A.ref.id],
                   'ズームのルートは除外される');
  // 親と子孫が両方選ばれていたら親だけ（deleteRef が子を連鎖削除するため）
  assert.deepEqual(deletableRoots(s, [A.ref.id, A1.ref.id], zoom), [A.ref.id],
                   '子孫は除外され親だけ残る');
  // 全日表示では day カード自身が除外される
  assert.deepEqual(deletableRoots(s, [P.ref.id, Q.ref.id], ALLDAYS), [P.ref.id, Q.ref.id],
                   '日の中のカードはどちらも対象');
}
{
  const { s, day, P } = fixture();
  assert.deepEqual(deletableRoots(s, [day.ref.id, P.ref.id], ALLDAYS), [P.ref.id],
                   '全日表示では day カード自身が除外される');
  assert.deepEqual(deletableRoots(s, [], { rootRef: null }), [], '空なら空');
}

console.log('PASS outline.ops');
