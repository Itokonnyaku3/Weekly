import assert from 'node:assert/strict';
import { filterMirrorRoots } from '../src/project.js';

const today = '2026-07-05';
// roots は { ref, body, day } 形式。フィルタは body を見る。
const r = (content, extra) => ({ ref: { id: 'r' }, body: { content, ...extra }, day: null });
const roots = [
  r('見積を出す', { due: '2026-07-01' }),                 // 期限切れ(-4)
  r('会議の準備', { due: '2026-07-08', done: false }),    // 今後3日
  r('請求処理', { done: true }),                          // 完了・期限なし
  r('資料作成', {}),                                      // 期限なし・未完
  r('見積レビュー', { due: '2026-08-20' }),               // 先(46日)
];

// フィルタなし＝全件
assert.equal(filterMirrorRoots(roots, {}, today).length, 5, 'フィルタなしは全件');

// キーワード「見積」＝2件
assert.deepEqual(filterMirrorRoots(roots, { kw: '見積' }, today).map(x => x.body.content), ['見積を出す', '見積レビュー'], 'キーワード部分一致');
// 大文字小文字を無視（英字）
assert.equal(filterMirrorRoots([r('ABC'), r('abcd')], { kw: 'abc' }, today).length, 2, 'ケースインセンシティブ');

// 完了を隠す＝「請求処理」除外
assert.ok(!filterMirrorRoots(roots, { hideDone: true }, today).some(x => x.body.content === '請求処理'), '完了を隠す');
assert.equal(filterMirrorRoots(roots, { hideDone: true }, today).length, 4, '完了1件を除外');

// 期限=あり → due を持つ3件
assert.equal(filterMirrorRoots(roots, { due: 'has' }, today).length, 3, '期限ありは3件');
// 期限=期限切れ → 見積を出す(-4)のみ
assert.deepEqual(filterMirrorRoots(roots, { due: 'overdue' }, today).map(x => x.body.content), ['見積を出す'], '期限切れ');
// 期限=今後7日 → 会議の準備(+3)のみ（見積レビュー+46は範囲外・期限切れは範囲外）
assert.deepEqual(filterMirrorRoots(roots, { due: 'soon' }, today).map(x => x.body.content), ['会議の準備'], '今後7日');

// 複合: キーワード「見積」＋期限切れ → 見積を出す のみ
assert.deepEqual(filterMirrorRoots(roots, { kw: '見積', due: 'overdue' }, today).map(x => x.body.content), ['見積を出す'], '複合条件');

console.log('PASS project.mirrorfilter');
