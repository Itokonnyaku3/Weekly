import assert from 'node:assert/strict';
import { cardWeekOf, isMilestone, toggleMsContent, MS_TAG } from '../src/week.js';

// ── 所属週の優先順位: ref.gridWk > body.due > 出所日 > createdAt ──
const day = '2026-07-22';        // 水曜（週=2026-07-20）

assert.equal(cardWeekOf({ due:'2026-08-05' }, { gridWk:'2026-09-07' }, day), '2026-09-07',
  'gridWk が最優先');
assert.equal(cardWeekOf({ due:'2026-08-05' }, {}, day), '2026-08-03',
  '期限があればその期限の週');
assert.equal(cardWeekOf({}, {}, day), '2026-07-20',
  '期限がなければ書き込まれた日の週');
assert.equal(cardWeekOf({ createdAt:'2026-06-10T09:00:00.000Z' }, {}, null), '2026-06-08',
  '出所日が取れなければ作成日の週');
assert.equal(cardWeekOf({ createdAt:'2026-06-07T20:00:00.000Z' }, {}, null), '2026-06-08',
  'createdAt は JST で日付を出す（JST 6/8(月) 05:00 ＝ UTC 6/7(日) → 前週にしない）');
assert.equal(cardWeekOf({}, {}, null), null, '何も手がかりが無ければ null');
assert.equal(cardWeekOf({}, null, day), '2026-07-20', 'ref が無くても落ちない');

// ── マイルストーン判定（本文の #マイルストーン タグ）──
assert.equal(MS_TAG, 'マイルストーン');
assert.equal(isMilestone({ content:'運用開始 #マイルストーン' }), true);
assert.equal(isMilestone({ content:'#マイルストーン 運用開始' }), true);
assert.equal(isMilestone({ content:'運用開始' }), false);
assert.equal(isMilestone({ content:'#マイルストーン2 運用開始' }), false, '別タグは誤判定しない');
assert.equal(isMilestone({}), false);
assert.equal(isMilestone(null), false);

// ── タグのトグル（本文を書き換える＝データの持ち方は1本）──
assert.equal(toggleMsContent('運用開始'), '運用開始 #' + MS_TAG, '付ける');
assert.equal(toggleMsContent('運用開始 #マイルストーン'), '運用開始', '外す');
assert.equal(toggleMsContent('#マイルストーン 運用開始'), '運用開始', '先頭にあっても外す');
assert.equal(toggleMsContent('A #マイルストーン B #HACCP'), 'A B #HACCP', '他のタグは残す');
assert.equal(toggleMsContent('A #マイルストーン2'), 'A #マイルストーン2 #' + MS_TAG,
  '別タグは外さずに付ける');
assert.equal(toggleMsContent(''), '#' + MS_TAG, '空でも付けられる');
assert.equal(toggleMsContent(toggleMsContent('運用開始')), '運用開始', '2回で元に戻る');

console.log('PASS week.cardweek');
