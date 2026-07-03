import assert from 'node:assert/strict';
import { midCounts } from '../src/list.js';

// midCounts は (proj,mid) ごとの件数マップを返す（キーは内部の midKeyOf 形式に依存しないよう、
// 値の分布と件数で検証する）。
const rows = [
  { proj:'p1', mid:'設計' }, { proj:'p1', mid:'設計' }, { proj:'p1', mid:'実装' },
  { proj:'p2', mid:'' },     // 中項目なし
  { proj:'', mid:'雑務' },   // 未所属
];
const m = midCounts(rows);
assert.equal(Object.keys(m).length, 4, '4グループ（p1設計 / p1実装 / p2なし / 未所属雑務）');
assert.deepEqual(Object.values(m).sort((a,b)=>a-b), [1,1,1,2], '件数分布=設計2・他は各1');
assert.equal(Object.values(m).reduce((a,b)=>a+b,0), rows.length, '合計は行数と一致');

// 同一 (proj,mid) は同じキーに集約され、proj違い・mid違いは別キーになる
assert.equal(Object.keys(midCounts([{proj:'p1',mid:'x'},{proj:'p1',mid:'x'}])).length, 1, '同一グループは1キー');
assert.equal(Object.keys(midCounts([{proj:'p1',mid:'x'},{proj:'p2',mid:'x'}])).length, 2, 'proj違いは別キー');
assert.equal(Object.keys(midCounts([{proj:'p1',mid:'x'},{proj:'p1',mid:'y'}])).length, 2, 'mid違いは別キー');

console.log('PASS list.midcount');
