import assert from 'node:assert/strict';
import { moveCursor, FIRST_WEEK_COL } from '../src/week.js';

// 2行 × 4列（proj, link, 週A, 週B）。counts はスロット数（空セルも1）
const shape = {
  rows: ['p1', 'p2'],
  cols: ['proj', 'link', 'wA', 'wB'],
  counts: new Map([
    ['p1|proj', 3], ['p1|link', 2], ['p1|wA', 3], ['p1|wB', 1],
    ['p2|proj', 1], ['p2|link', 1], ['p2|wA', 2], ['p2|wB', 1],
  ]),
};
const at = (row, colIdx, idx) => ({ row, colIdx, idx });
const mv = (c, key) => moveCursor(shape, c, key);

assert.equal(FIRST_WEEK_COL, 2, 'cols[0]=proj / cols[1]=link なので最初の週列は index 2');

// ── ↓: セル内を進み、最下段で次のPJの同じ列の先頭へ ──
assert.deepEqual(mv(at('p1', 2, 0), 'ArrowDown').cursor, at('p1', 2, 1), 'セル内で下へ');
assert.deepEqual(mv(at('p1', 2, 2), 'ArrowDown').cursor, at('p2', 2, 0), '最下段→次PJのセル先頭');
assert.deepEqual(mv(at('p2', 2, 1), 'ArrowDown').cursor, at('p2', 2, 1), '最終行では動かない');
assert.equal(mv(at('p1', 2, 2), 'ArrowDown').page, 0, '縦移動で週送りはしない');

// ── ↑: 最上段で前のPJの同じ列の末尾へ ──
assert.deepEqual(mv(at('p1', 2, 1), 'ArrowUp').cursor, at('p1', 2, 0));
assert.deepEqual(mv(at('p2', 2, 0), 'ArrowUp').cursor, at('p1', 2, 2), '最上段→前PJのセル末尾');
assert.deepEqual(mv(at('p1', 0, 0), 'ArrowUp').cursor, at('p1', 0, 0), '先頭行では動かない');

// ── →/←: 行内で列移動。縦位置は保つ（無ければ末尾にクランプ）──
assert.deepEqual(mv(at('p1', 0, 0), 'ArrowRight').cursor, at('p1', 1, 0));
assert.deepEqual(mv(at('p1', 2, 2), 'ArrowRight').cursor, at('p1', 3, 0),
  '移動先のスロットが1つなら末尾(=0)にクランプ');
assert.deepEqual(mv(at('p1', 1, 1), 'ArrowLeft').cursor, at('p1', 0, 1), '縦位置を保つ');
assert.deepEqual(mv(at('p1', 2, 0), 'ArrowLeft').cursor, at('p1', 1, 0));

// ── 端で週送り（左右対称：新しく現れた週列にフォーカス）──
const right = mv(at('p1', 3, 0), 'ArrowRight');
assert.equal(right.page, 1, '右端でさらに→ は週送り(進む)');
assert.deepEqual(right.cursor, at('p1', 3, 0), '右端の列に留まる＝新しく現れた週');
const left = mv(at('p1', 0, 1), 'ArrowLeft');
assert.equal(left.page, -1, '左端でさらに← は週送り(戻る)');
assert.deepEqual(left.cursor, at('p1', FIRST_WEEK_COL, 0), '新しく現れた最初の週列へ');

// ── Tab / Shift+Tab: セル単位 ──
assert.deepEqual(mv(at('p1', 2, 2), 'Tab').cursor, at('p1', 3, 0), '次のセルの先頭');
assert.deepEqual(mv(at('p1', 3, 0), 'Tab').cursor, at('p2', 0, 0), '行末→次PJの先頭列');
assert.deepEqual(mv(at('p2', 3, 0), 'Tab').cursor, at('p2', 3, 0), '最終セルでは動かない');
assert.deepEqual(mv(at('p2', 0, 0), 'ShiftTab').cursor, at('p1', 3, 0), '行頭→前PJの末尾列');
assert.deepEqual(mv(at('p1', 2, 1), 'ShiftTab').cursor, at('p1', 1, 0));

// ── Home / End ──
assert.deepEqual(mv(at('p1', 2, 1), 'Home').cursor, at('p1', 0, 0));
assert.deepEqual(mv(at('p1', 0, 0), 'End').cursor, at('p1', 3, 0));

// ── 未知キーは動かない ──
assert.deepEqual(mv(at('p1', 1, 1), 'KeyX').cursor, at('p1', 1, 1));

// ── 消えた行/列・範囲外の idx は近傍にクランプ（再描画で行が減った場合）──
assert.deepEqual(mv(at('missing', 2, 0), 'ArrowDown').cursor, at('p1', 2, 1),
  '消えた行は先頭行として扱う');
assert.deepEqual(mv(at('p1', 99, 0), 'ArrowUp').cursor, at('p1', 3, 0), '範囲外の列をクランプ');
assert.deepEqual(mv(at('p1', 2, 99), 'ArrowUp').cursor, at('p1', 2, 1), '範囲外の idx をクランプ');

// ── counts に無い (row,col) は空セル＝スロット1 として扱う ──
const bare = { rows:['r1'], cols:['proj','link','wA'], counts: new Map() };
assert.deepEqual(moveCursor(bare, at('r1', 0, 0), 'ArrowDown').cursor, at('r1', 0, 0));
assert.deepEqual(moveCursor(bare, at('r1', 0, 0), 'ArrowRight').cursor, at('r1', 1, 0));

console.log('PASS week.cursor');
