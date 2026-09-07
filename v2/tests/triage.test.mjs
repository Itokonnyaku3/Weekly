import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { untaggedIslands, kindsSummary, withTags, allTags, parseTagInput } from '../src/triage.js';

// ツリー:
//  day > 会議 > A, B(>B1)        … 無タグの塊（頭=会議・4件）
//  day > 単独                     … 無タグの塊（頭=単独・1件）
//  day > タグ付き > C             … 祖先にタグ → 対象外
//  day > PJカード > D             … PJページ配下 → 対象外
//  day > 自分にタグ               … 対象外
const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-09-06' });
const mtg = s.createCard({ kind:'memo', content:'1000 リーダー会', parentRefId: day.ref.id });
const A   = s.createCard({ kind:'memo',  content:'A', parentRefId: mtg.ref.id });
const B   = s.createCard({ kind:'task',  content:'B', parentRefId: mtg.ref.id });
const B1  = s.createCard({ kind:'image', content:'v2-data/img/x.png', parentRefId: B.ref.id });
const solo = s.createCard({ kind:'memo', content:'単独メモ', parentRefId: day.ref.id });
const pj = s.createProject ? null : null;
const tagged = s.createCard({ kind:'memo', content:'タグ付き親', proj:'p1', parentRefId: day.ref.id });
const C = s.createCard({ kind:'memo', content:'C', parentRefId: tagged.ref.id });
const pjCard = s.createCard({ kind:'project', content:'HACCP', parentRefId: day.ref.id });
const D = s.createCard({ kind:'memo', content:'D', parentRefId: pjCard.ref.id });
const own = s.createCard({ kind:'memo', content:'自分にタグ', proj:'p1', parentRefId: day.ref.id });

const got = untaggedIslands(s);
const byHead = Object.fromEntries(got.map(g => [g.label, g]));

// 塊は2つだけ（会議4件・単独1件）。件数の降順で返る
assert.deepEqual(got.map(g => g.label), ['1000 リーダー会', '単独メモ'], '件数の降順');
assert.equal(byHead['1000 リーダー会'].count, 4, '頭+A+B+B1 = 4件');
assert.equal(byHead['単独メモ'].count, 1);
assert.equal(byHead['1000 リーダー会'].day, '2026-09-06', '出所の日付');
assert.equal(byHead['1000 リーダー会'].headBodyId, mtg.body.id, '頭は日の直下のカード');

// 祖先にタグ / PJページ配下 / 自分にタグ は対象外
assert.equal(got.some(g => g.label.includes('タグ付き')), false, '祖先にタグがあれば対象外');
assert.equal(got.some(g => g.label === 'C'), false);
assert.equal(got.some(g => g.label === 'D'), false, 'PJページ配下は対象外');
assert.equal(got.some(g => g.label === '自分にタグ'), false);

// 内訳（種類ごとの件数）
assert.deepEqual(byHead['1000 リーダー会'].kinds, { memo:2, task:1, image:1 }, '頭もメモとして数える');

// タグも「拾う手がかり」として数える（第2の軸がタグなので）
{
  const s3 = createStore();
  const d3 = s3.createCard({ kind:'day', content:'2026-09-06' });
  const h  = s3.createCard({ kind:'memo', content:'会議 #HACCP', parentRefId: d3.ref.id });
  s3.createCard({ kind:'memo', content:'子', parentRefId: h.ref.id });
  assert.deepEqual(untaggedIslands(s3), [], '祖先に #タグ があれば対象外');
}
{
  const s4 = createStore();
  const d4 = s4.createCard({ kind:'day', content:'2026-09-06' });
  s4.createCard({ kind:'memo', content:'自分に #タグ', parentRefId: d4.ref.id });
  assert.deepEqual(untaggedIslands(s4), [], '自分に #タグ があれば対象外');
}

// 棚卸しでタグを入れると、その塊が一覧から消える（進捗が見える）
{
  const s5 = createStore();
  const d5 = s5.createCard({ kind:'day', content:'2026-09-06' });
  const h5 = s5.createCard({ kind:'memo', content:'週次', parentRefId: d5.ref.id });
  s5.createCard({ kind:'memo', content:'中身', parentRefId: h5.ref.id });
  assert.equal(untaggedIslands(s5).length, 1, 'まだ手がかりが無い');
  s5.updateBody(h5.body.id, { content: withTags(h5.body.content, ['週次報告']) });
  assert.deepEqual(untaggedIslands(s5), [], 'タグを入れたら塊ごと消える');
}

// 頭にPJを付けると塊ごと消える（＝配下も拾えるようになる）
s.updateBody(mtg.body.id, { proj: 'p2' });
assert.deepEqual(untaggedIslands(s).map(g => g.label), ['単独メモ'], '頭1枚で塊ごと解決');

// day の下に無いカード（孤児）は対象外＝落ちない
const s2 = createStore();
s2.createCard({ kind:'memo', content:'孤児' });
assert.deepEqual(untaggedIslands(s2), [], '日の下に無いカードは出さない');
assert.deepEqual(untaggedIslands(createStore()), [], '空のストアでも落ちない');

// --- kindsSummary ---
assert.equal(kindsSummary({ memo:3, image:2 }), 'メモ3 / 画像2', '多い順');
assert.equal(kindsSummary({ image:1, memo:5 }), 'メモ5 / 画像1');
assert.equal(kindsSummary({}), '');
assert.equal(kindsSummary(null), '', 'null でも落ちない');

// --- withTags ---
assert.equal(withTags('会議メモ', ['HACCP']), '会議メモ #HACCP');
assert.equal(withTags('会議メモ', ['A', 'B']), '会議メモ #A #B', '複数');
assert.equal(withTags('会議メモ ', ['A']), '会議メモ #A', '末尾の空白を二重にしない');
assert.equal(withTags('会議メモ #A', ['A']), '会議メモ #A', '既にあるタグは重ねない');
assert.equal(withTags('会議メモ #A', ['A', 'B']), '会議メモ #A #B', '無いものだけ足す');
assert.equal(withTags('会議メモ', ['#A']), '会議メモ #A', '# 付きで入れても良い');
assert.equal(withTags('会議メモ', []), '会議メモ', '空なら変えない');
assert.equal(withTags('', ['A']), '#A', '空の本文でも良い');
assert.equal(withTags(null, ['A']), '#A', 'null でも落ちない');
assert.equal(withTags('会議メモ', ['  ']), '会議メモ', '空白だけは無視');

console.log('PASS triage');

// --- 済（棚卸し済み）: triaged が付いた塊は triaged:true で返る ---
{
  const s6 = createStore();
  const d6 = s6.createCard({ kind:'day', content:'2026-09-06' });
  const h6 = s6.createCard({ kind:'memo', content:'ただのメモ', parentRefId: d6.ref.id });
  assert.equal(untaggedIslands(s6)[0].triaged, false, '既定は未処理');
  s6.updateBody(h6.body.id, { triaged: true });
  assert.equal(untaggedIslands(s6)[0].triaged, true, '済の印が読める');
  s6.updateBody(h6.body.id, { triaged: false });
  assert.equal(untaggedIslands(s6)[0].triaged, false, '戻せる');
}

// --- hasMedia: 画像・表を含む塊は印が付く（文字が無く検索でも辿れない） ---
{
  const s7 = createStore();
  const d7 = s7.createCard({ kind:'day', content:'2026-09-06' });
  const a7 = s7.createCard({ kind:'memo', content:'文字だけの塊', parentRefId: d7.ref.id });
  s7.createCard({ kind:'memo', content:'子', parentRefId: a7.ref.id });
  const b7 = s7.createCard({ kind:'memo', content:'画像を含む塊', parentRefId: d7.ref.id });
  s7.createCard({ kind:'image', content:'v2-data/img/a.png', parentRefId: b7.ref.id });
  const g = Object.fromEntries(untaggedIslands(s7).map(x => [x.label, x]));
  assert.equal(g['文字だけの塊'].hasMedia, false);
  assert.equal(g['画像を含む塊'].hasMedia, true, '画像を含む塊に印');
}
{
  const s8 = createStore();
  const d8 = s8.createCard({ kind:'day', content:'2026-09-06' });
  const h8 = s8.createCard({ kind:'memo', content:'表を含む塊', parentRefId: d8.ref.id });
  s8.createCard({ kind:'table', content:'{"rows":[["x"]]}', parentRefId: h8.ref.id });
  assert.equal(untaggedIslands(s8)[0].hasMedia, true, '表でも印が付く');
}

// --- allTags: 既存タグを多い順に（棚卸しの選択肢） ---
{
  const s9 = createStore();
  const d9 = s9.createCard({ kind:'day', content:'2026-09-06' });
  s9.createCard({ kind:'memo', content:'a #HACCP',        parentRefId: d9.ref.id });
  s9.createCard({ kind:'memo', content:'b #HACCP #稟議',  parentRefId: d9.ref.id });
  s9.createCard({ kind:'memo', content:'c #稟議',         parentRefId: d9.ref.id });
  s9.createCard({ kind:'memo', content:'d #会議',         parentRefId: d9.ref.id });
  const t = allTags(s9);
  assert.deepEqual(t.map(x => x.tag), ['HACCP', '稟議', '会議'], '多い順。同数は名前順');
  assert.deepEqual(t.map(x => x.count), [2, 2, 1]);
  assert.deepEqual(allTags(createStore()), [], 'タグが無ければ空');
}

// --- parseTagInput: 入力欄の文字列 → タグ配列 ---
assert.deepEqual(parseTagInput('会議 HACCP'), ['会議', 'HACCP'], '空白区切り');
assert.deepEqual(parseTagInput('会議,HACCP'), ['会議', 'HACCP'], 'カンマ区切り');
assert.deepEqual(parseTagInput('#会議 #HACCP'), ['会議', 'HACCP'], '# は外す');
assert.deepEqual(parseTagInput('  会議   '), ['会議'], '前後の空白を無視');
assert.deepEqual(parseTagInput(''), [], '空');
assert.deepEqual(parseTagInput(null), [], 'null でも落ちない');
assert.deepEqual(parseTagInput('#'), [], '# だけは無視');

console.log('PASS triage (追加分)');
