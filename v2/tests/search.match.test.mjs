import assert from 'node:assert/strict';
import { cardTags, matchCard, runQuery } from '../src/search.js';
import { createStore } from '../src/store.js';

const today = '2026-07-05';
const b = (o) => Object.assign({ kind:'task', content:'', proj:undefined, due:'', prio:0, done:false }, o);

// cardTags
assert.deepEqual([...cardTags('資料 #設計 と #実装')].sort(), ['実装','設計']);
assert.deepEqual([...cardTags('タグなし')], []);

// kind: memo/task/image/table を対象。day と project は「器」なので対象外。
assert.equal(matchCard(b({ kind:'day', content:'x' }), {}, today), false, 'day は対象外');
assert.equal(matchCard(b({ kind:'project', content:'x' }), {}, today), false, 'project は対象外');
assert.equal(matchCard(b({ kind:'memo', content:'x' }), {}, today), true, 'memo は対象');
assert.equal(matchCard(b({ kind:'task', content:'x' }), {}, today), true, 'task は対象');
assert.equal(matchCard(b({ kind:'image', content:'v2-data/img/img_1.png' }), {}, today), true, 'image は対象');
assert.equal(matchCard(b({ kind:'table', content:'{"rows":[["a"]]}' }), {}, today), true, 'table は対象');
assert.equal(matchCard(b({ kind:'unknown', content:'x' }), {}, today), false, '未知の種類は対象外');
assert.equal(matchCard(null, {}, today), false, 'body なしは対象外');

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

// kind 条件（既定 'all' は全種類・特定種類はそれだけ）
{
  const memo  = b({ kind:'memo',  content:'議事メモ' });
  const task  = b({ kind:'task',  content:'見積対応' });
  const image = b({ kind:'image', content:'v2-data/img/img_1782356143821.png' });
  const table = b({ kind:'table', content:'{"rows":[["HACCP追加改修","富士通3,500,000"]]}' });

  for (const x of [memo, task, image, table]){
    assert.equal(matchCard(x, { kind:'all' }, today), true, 'kind:all は ' + x.kind + ' に一致');
    assert.equal(matchCard(x, {}, today), true, 'kind未指定は ' + x.kind + ' に一致（既存クエリの後方互換）');
  }
  assert.equal(matchCard(image, { kind:'image' }, today), true, 'kind:image は画像に一致');
  assert.equal(matchCard(memo,  { kind:'image' }, today), false, 'kind:image はメモに不一致');
  assert.equal(matchCard(task,  { kind:'image' }, today), false, 'kind:image はタスクに不一致');
  assert.equal(matchCard(table, { kind:'image' }, today), false, 'kind:image は表に不一致');
  // 器は kind 指定にも出てこない
  assert.equal(matchCard(b({ kind:'day', content:'2026-07-05' }), { kind:'all' }, today), false, 'kind:all でも day は出さない');

  // キーワード: 表はセルの文字で引ける／画像はパスに誤ヒットしない
  assert.equal(matchCard(table, { keyword:'HACCP追加改修' }, today), true, '表はセルの文字で引ける');
  assert.equal(matchCard(image, { keyword:'img' }, today), false, '画像はパスに誤ヒットしない');
  // OCR の差し込み口が機能すること
  assert.equal(
    matchCard(b({ kind:'image', content:'v2-data/img/img_1.png', ocr:'HACCP追加改修の稟議' }), { keyword:'HACCP追加改修' }, today),
    true, 'body.ocr を入れた画像はキーワードで一致する'
  );
  // 壊れた JSON の表でも例外を投げない
  assert.equal(matchCard(b({ kind:'table', content:'{"rows":[[' }), { keyword:'HACCP' }, today), false, '壊れた表は非該当（例外なし）');
}

// runQuery: day を対象外にしているため、条件なしでも配下のカードが消えない
{
  const s = createStore();
  const day = s.createCard({ kind:'day', content:'2026-07-05' });
  s.createCard({ kind:'memo',  content:'議事メモ', parentRefId: day.ref.id });
  s.createCard({ kind:'task',  content:'見積対応', parentRefId: day.ref.id });
  s.createCard({ kind:'image', content:'v2-data/img/img_1782356143821.png', parentRefId: day.ref.id });
  s.createCard({ kind:'table', content:'{"rows":[["HACCP追加改修"]]}', parentRefId: day.ref.id });

  const kinds = runQuery(s, {}, today).map(r => r.body.kind).sort();
  assert.deepEqual(kinds, ['image','memo','table','task'], '条件なしで4種類すべてが最上位一致として残る（day が祖先一致で消さない）');

  // 種類で絞れば画像だけ
  const imgs = runQuery(s, { kind:'image' }, today);
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].body.kind, 'image');

  // 表はセルの文字で引ける
  const hit = runQuery(s, { keyword:'HACCP追加改修' }, today);
  assert.equal(hit.length, 1, '表がキーワードで1件引ける');
  assert.equal(hit[0].body.kind, 'table');
}

console.log('PASS search.match');
