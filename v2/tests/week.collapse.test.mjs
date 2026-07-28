import assert from 'node:assert/strict';
import { rowCollapseStep } from '../src/week.js';

const ROWS = ['p1', 'p2', 'p3', '__none'];
const sorted = (a) => [...a].sort();

// ── 折りたたみ（Ctrl+↑）──
// 全体表示 → フォーカス行だけ畳む
assert.deepEqual(rowCollapseStep(ROWS, [], 'p2', 'collapse'), ['p2']);
// 他の行が畳まれていても、フォーカス行が開いていればフォーカス行を足すだけ
assert.deepEqual(sorted(rowCollapseStep(ROWS, ['p1'], 'p2', 'collapse')), ['p1', 'p2']);
// フォーカス行がすでに畳まれている → 全部畳む
assert.deepEqual(sorted(rowCollapseStep(ROWS, ['p2'], 'p2', 'collapse')), sorted(ROWS));
// 未割当行も同じ扱い
assert.deepEqual(rowCollapseStep(ROWS, [], '__none', 'collapse'), ['__none']);

// ── 展開（Ctrl+↓）──
// フォーカス行が畳まれている → その行だけ開く
assert.deepEqual(sorted(rowCollapseStep(ROWS, ['p1', 'p2'], 'p2', 'expand')), ['p1']);
// フォーカス行が開いている → 全部開く
assert.deepEqual(rowCollapseStep(ROWS, ['p1', 'p3'], 'p2', 'expand'), []);
// 全部畳んだ状態から: 1回目はフォーカス行だけ開く → 2回目で全部開く
const step1 = rowCollapseStep(ROWS, ROWS, 'p2', 'expand');
assert.deepEqual(sorted(step1), ['__none', 'p1', 'p3']);
assert.deepEqual(rowCollapseStep(ROWS, step1, 'p2', 'expand'), []);

// ── 往復（畳む→畳む→開く→開く）が期待どおりに戻る ──
let st = [];
st = rowCollapseStep(ROWS, st, 'p1', 'collapse'); assert.deepEqual(st, ['p1']);
st = rowCollapseStep(ROWS, st, 'p1', 'collapse'); assert.deepEqual(sorted(st), sorted(ROWS));
st = rowCollapseStep(ROWS, st, 'p1', 'expand');   assert.deepEqual(sorted(st), ['__none', 'p2', 'p3']);
st = rowCollapseStep(ROWS, st, 'p1', 'expand');   assert.deepEqual(st, []);

// ── 壊れた/古い保存値への耐性 ──
// 消えたPJのIDは落とす（残骸で「全部畳む」判定が狂わない）
assert.deepEqual(sorted(rowCollapseStep(ROWS, ['zombie', 'p1'], 'p2', 'collapse')), ['p1', 'p2']);
assert.deepEqual(rowCollapseStep(ROWS, ['zombie'], 'p2', 'expand'), [], '残骸だけなら全部開くで空に');
// 行に無いIDでの折りたたみ要求は「全部畳む」（クラッシュしない）
assert.deepEqual(sorted(rowCollapseStep(ROWS, [], 'nope', 'collapse')), sorted(ROWS));
// null/undefined でも落ちない
assert.deepEqual(rowCollapseStep(ROWS, null, 'p1', 'collapse'), ['p1']);
assert.deepEqual(rowCollapseStep(null, null, 'p1', 'expand'), []);

// 元の配列は変更しない（呼び出し側の state を壊さない）
const before = ['p1'];
rowCollapseStep(ROWS, before, 'p2', 'collapse');
assert.deepEqual(before, ['p1']);

console.log('PASS week.collapse');
