import assert from 'node:assert/strict';
import { weekStart, weekAdd, weekLabel, weeksFor, shiftDays, WEEK_COUNT, WEEK_BACK } from '../src/week.js';

// 2026-07-26 は日曜 → その週の月曜は 2026-07-20
assert.equal(weekStart('2026-07-26'), '2026-07-20', '日曜は前の月曜が週頭');
assert.equal(weekStart('2026-07-20'), '2026-07-20', '月曜はその日が週頭');
assert.equal(weekStart('2026-07-21'), '2026-07-20', '火曜');
assert.equal(weekStart('2026-07-27'), '2026-07-27', '次の月曜');
assert.equal(weekStart('2026-07-26T12:34:56.000Z'), '2026-07-20', 'ISO文字列も先頭10文字で扱う');

// 月末・年越し
assert.equal(weekStart('2026-03-01'), '2026-02-23', '月をまたぐ');
assert.equal(weekStart('2027-01-01'), '2026-12-28', '年をまたぐ（金曜→前の月曜）');

// 不正値は null（壊れた保存データでクラッシュしない）
assert.equal(weekStart(''), null);
assert.equal(weekStart(null), null);
assert.equal(weekStart('not-a-date'), null);

// 週の加減算
assert.equal(weekAdd('2026-07-20', 1), '2026-07-27');
assert.equal(weekAdd('2026-07-20', -1), '2026-07-13');
assert.equal(weekAdd('2026-12-28', 1), '2027-01-04', '年をまたぐ加算');
assert.equal(weekAdd('2026-07-20', 0), '2026-07-20');

// 日数の加減算
assert.equal(shiftDays('2026-07-20', 6), '2026-07-26');
assert.equal(shiftDays('2026-02-28', 1), '2026-03-01', '平年の2月末');

// ラベル（月曜〜日曜）
assert.equal(weekLabel('2026-07-20'), '7/20〜7/26');
assert.equal(weekLabel('2026-12-28'), '12/28〜1/3', '年をまたぐラベル');

// 表示週: 既定は 先週 〜 今週+4 の6週
const ws = weeksFor('2026-07-26');
assert.equal(WEEK_COUNT, 6);
assert.equal(WEEK_BACK, 1);
assert.equal(ws.length, 6);
assert.equal(ws[0], '2026-07-13', '先頭は先週');
assert.equal(ws[1], '2026-07-20', '2番目が今週');
assert.equal(ws[5], '2026-08-17', '末尾は今週+4');
assert.deepEqual(weeksFor('2026-07-26', 1), ws.map(w => weekAdd(w, 1)), 'offsetで週送り');
assert.deepEqual(weeksFor('2026-07-26', -2), ws.map(w => weekAdd(w, -2)));

console.log('PASS week.key');
