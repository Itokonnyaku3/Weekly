import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { mirrorPath, pathSegments, pathLabel } from '../src/daily.js';

// ツリー: day > 会議 > 議題 > 詳細 / day > 単独
const s = createStore();
const day = s.createCard({ kind:'day',  content:'2026-09-06' });
const mtg = s.createCard({ kind:'memo', content:'1000 リーダー会', parentRefId: day.ref.id });
const ag  = s.createCard({ kind:'memo', content:'電波対策',       parentRefId: mtg.ref.id });
const det = s.createCard({ kind:'memo', content:'楽天へ再依頼',   parentRefId: ag.ref.id });
const solo = s.createCard({ kind:'task', content:'単独タスク',    parentRefId: day.ref.id });

const txt = (chain) => chain.map(b => b.content);

// day より下の祖先だけを、日に近い順で返す
assert.deepEqual(txt(mirrorPath(s, det.ref.id)), ['1000 リーダー会', '電波対策'], '祖先2つ');
assert.deepEqual(txt(mirrorPath(s, ag.ref.id)),  ['1000 リーダー会'], '祖先1つ');
assert.deepEqual(mirrorPath(s, mtg.ref.id), [], '日の直下は祖先なし＝何も出さない');
assert.deepEqual(mirrorPath(s, solo.ref.id), [], '単独タスクも祖先なし');
assert.deepEqual(mirrorPath(s, 'r-none'), [], '無い ref でも落ちない');

// day 自身は含めない（呼び出し側が見出しに出しているため）
assert.equal(mirrorPath(s, det.ref.id).every(b => b.kind !== 'day'), true, 'day は含まれない');

// 表示する区切り: 上限以下はそのまま、超えたら間を null（…）で省く
const a = { content:'A' }, b = { content:'B' }, c = { content:'C' }, d = { content:'D' };
assert.deepEqual(pathSegments([a], 2), [a]);
assert.deepEqual(pathSegments([a, b], 2), [a, b], '上限ちょうどはそのまま');
assert.deepEqual(pathSegments([a, b, c], 2), [a, null, c], '3つ以上は間を省く');
assert.deepEqual(pathSegments([a, b, c, d], 2), [a, null, d], '最初と最後を残す');
assert.deepEqual(pathSegments([], 2), [], '空は空');

// 元の配列を壊さない（描画のたびに呼ばれる）
const src = [a, b];
pathSegments(src, 2).push(c);
assert.deepEqual(src, [a, b], '入力を書き換えない');

// --- pathLabel: 文脈として読める形に整える ---
assert.equal(pathLabel({ kind:'memo', content:'1000 リーダー会' }), '1000 リーダー会');
assert.equal(pathLabel({ kind:'image', content:'v2-data/img/a.png' }), '画像', '画像はパスを出さない');
assert.equal(pathLabel({ kind:'table', content:'{"rows":[]}' }), '表');
assert.equal(pathLabel({ kind:'memo', content:'岐南 #HACCP' }), '岐南', 'タグを落とす');
assert.equal(pathLabel({ kind:'memo', content:'岐南 #' }), '岐南', '単独の # も落とす');
assert.equal(pathLabel({ kind:'memo', content:'【📅260930】 会議メモ' }), '会議メモ', '日付マーカーを落とす');
assert.equal(pathLabel({ kind:'memo', content:'⟦b12⟧ の件' }), 'の件', 'リンク記法を落とす');
assert.equal(pathLabel({ kind:'memo', content:['A  ', ' B', String.fromCharCode(10), 'C'].join('') }), 'A B C', '空白を詰める');
assert.equal(pathLabel({ kind:'memo', content:'結論：' }), '結論', '末尾の区切りを落とす');
assert.equal(pathLabel({ kind:'memo', content:'#HACCP' }), '(空)', 'タグだけなら空扱い');
assert.equal(pathLabel({ kind:'memo' }), '(空)', 'content なしでも落ちない');
assert.equal(pathLabel(null), '', 'null でも落ちない');
{
  const long = 'あ'.repeat(30);
  const out = pathLabel({ kind:'memo', content: long });
  assert.equal(out.length, 19, '18文字＋…に切る');
  assert.equal(out.endsWith('…'), true);
}

console.log('PASS daily.mirrorpath');
