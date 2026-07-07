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
