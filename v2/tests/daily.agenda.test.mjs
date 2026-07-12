import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { dayAgenda } from '../src/daily.js';

const today = '2026-07-10';
const s = createStore();
const day = s.createCard({ kind:'day', content: today });

// メモ（当日期限＝リマインダ）
s.createCard({ kind:'memo', content:'当日メモ', due: today, parentRefId: day.ref.id });
// メモ（別日期限）→ 対象外
s.createCard({ kind:'memo', content:'翌日メモ', due:'2026-07-11', parentRefId: day.ref.id });
// 本日期限タスク（未完）
s.createCard({ kind:'task', content:'本日タスク', due: today, parentRefId: day.ref.id });
// 期限切れタスク（未完）
s.createCard({ kind:'task', content:'超過タスク', due:'2026-07-08', parentRefId: day.ref.id });
// 期限切れだが完了 → 対象外
const doneOver = s.createCard({ kind:'task', content:'超過完了', due:'2026-07-08', parentRefId: day.ref.id });
s.updateBody(doneOver.body.id, { done:true });
// 期限なしタスク（未完）
s.createCard({ kind:'task', content:'期限なしタスク', parentRefId: day.ref.id });
// 期限なしだが完了 → 対象外
const doneNo = s.createCard({ kind:'task', content:'期限なし完了', parentRefId: day.ref.id });
s.updateBody(doneNo.body.id, { done:true });

const g = dayAgenda(s, today);
const names = (arr) => arr.map(x => x.body.content).sort();
assert.deepEqual(names(g.memo), ['当日メモ'], 'メモ＝当日期限のメモのみ');
assert.deepEqual(names(g.due), ['本日タスク'], '本日期限＝due==当日の未完タスク');
assert.deepEqual(names(g.overdue), ['超過タスク'], '期限切れ＝due<当日の未完タスク（完了は除外）');
assert.deepEqual(names(g.nodue), ['期限なしタスク'], '期限なし＝dueなし未完（完了は除外）');

// 表示日基準（過去/未来日でも表示日 D 基準で判定）: 翌日にフォーカス。
// 期限切れ＝due<翌日（＝当日ぶんも含む）、期限なしはどの表示日でも、メモ/本日期限は due==翌日。
const g2 = dayAgenda(s, '2026-07-11');
assert.deepEqual(names(g2.memo), ['翌日メモ'], '別日: メモは due==その日');
assert.deepEqual(names(g2.due), [], '別日: due==翌日 のタスクは無し');
assert.deepEqual(names(g2.overdue), ['本日タスク','超過タスク'], '別日: 期限切れ＝due<翌日（当日ぶんも含む）');
assert.deepEqual(names(g2.nodue), ['期限なしタスク'], '別日: 期限なしは表示日に依らず表示');

// 未来期限は対象外（過去日にフォーカスしたとき）: 前日にフォーカス。
const g4 = dayAgenda(s, '2026-07-09');
assert.deepEqual(names(g4.overdue), ['超過タスク'], '前日: due<前日 のみ（本日タスクは未来期限で対象外）');
assert.deepEqual(names(g4.due), [], '前日: due==前日 は無し');

// 祖先も一致するときは最上位のみ（重複除外）
const s2 = createStore();
const d2 = s2.createCard({ kind:'day', content: today });
const parent = s2.createCard({ kind:'task', content:'親タスク', due: today, parentRefId: d2.ref.id });
s2.createCard({ kind:'task', content:'子タスク', due: today, parentRefId: parent.ref.id });
const g3 = dayAgenda(s2, today);
assert.deepEqual(g3.due.map(x => x.body.content), ['親タスク'], '親配下の一致は親だけ返す');

console.log('PASS daily.agenda');
