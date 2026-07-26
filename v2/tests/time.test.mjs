import assert from 'node:assert/strict';
import { TZ_OFFSET_MIN, todayStr, dateOf } from '../src/time.js';

assert.equal(TZ_OFFSET_MIN, 540, 'JST = UTC+9');

// ── todayStr: JST 00:00〜08:59 は UTC では前日 ＝ ここがズレていた ──
assert.equal(todayStr(new Date('2026-07-26T23:42:46.223Z')), '2026-07-27',
  'JST 7/27 08:42 → 7/27（toISOString だと 7/26 になっていた）');
assert.equal(todayStr(new Date('2026-07-26T15:00:00.000Z')), '2026-07-27',
  'JST 7/27 00:00 ちょうど → 7/27');
assert.equal(todayStr(new Date('2026-07-27T14:59:59.999Z')), '2026-07-27',
  'JST 7/27 23:59:59 → まだ 7/27');
assert.equal(todayStr(new Date('2026-07-27T15:00:00.000Z')), '2026-07-28',
  'JST 7/28 00:00 → 日付が変わる');
assert.equal(todayStr(new Date('2026-12-31T15:00:00.000Z')), '2027-01-01', '年またぎ');
assert.match(todayStr(), /^\d{4}-\d{2}-\d{2}$/, '引数なしでも整形された日付');

// ── dateOf: 保存済みの UTC ISO（createdAt / doneAt）を JST の日付に落とす ──
assert.equal(dateOf('2026-07-26T23:42:46.223Z'), '2026-07-27',
  'JST 7/27 08:42 に完了 → 完了日は 7/27');
assert.equal(dateOf('2026-07-27T14:00:00.000Z'), '2026-07-27');
assert.equal(dateOf('2026-07-27T15:00:00.000Z'), '2026-07-28');
assert.equal(dateOf(new Date('2026-07-26T23:00:00.000Z')), '2026-07-27', 'Date でも受ける');

// 時刻を持たない値はTZの概念が無い＝そのまま（期限・日カードをずらさない）
assert.equal(dateOf('2026-07-27'), '2026-07-27');
// TZ指定の無い日時はJSTの壁時計扱い＝実行環境のTZで結果が変わらない
assert.equal(dateOf('2026-07-27T22:00:00'), '2026-07-27');
assert.equal(dateOf('2026-07-27T00:30:00'), '2026-07-27');

// 壊れた保存データでクラッシュしない
assert.equal(dateOf(''), '');
assert.equal(dateOf(null), '');
assert.equal(dateOf(undefined), '');
assert.equal(dateOf('こわれた値'), '');
assert.equal(dateOf(new Date('x')), '');
assert.equal(todayStr('こわれた値'), '');

console.log('PASS time');
