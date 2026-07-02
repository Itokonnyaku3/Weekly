import assert from 'node:assert/strict';
import { selectTasks, viewToGroups } from '../src/list.js';

const today = '2026-06-17';
const tasks = [
  { id:'1', content:'A', due:'2026-06-18', prio:1, createdAt:'2026-06-01T00:00:00Z' }, // +1日
  { id:'2', content:'B', due:'2026-06-25', prio:3, createdAt:'2026-06-02T00:00:00Z' }, // +8日
  { id:'3', content:'C', due:'2026-06-10', prio:0, done:true, doneAt:'2026-06-16T10:00:00Z', createdAt:'2026-06-03T00:00:00Z' }, // -7日(期限切れ・完了・完了日-1日)
  { id:'4', content:'D', createdAt:'2026-06-04T00:00:00Z' },                            // 期限なし
];
// 条件グループの雛形（既定=すべて）に部分的な上書きをマージするヘルパ
const g = (patch) => ({
  due:{mode:'any',from:null,to:null}, done:{mode:'any',from:null,to:null},
  proj:'all', mid:'', prio:'all', ...patch,
});

// opts省略・空groups → 既定1グループ（絞り込みなし）で全件
assert.equal(selectTasks(tasks, undefined, today).length, 4, '既定は全件表示（絞り込みなし）');

// 期限=範囲(0〜3) → A のみ（旧 next3 相当）
assert.deepEqual(selectTasks(tasks, { groups:[g({ due:{mode:'range',from:0,to:3} })], sort:'due' }, today).map(t=>t.id), ['1']);
// 期限=範囲(無制限〜-1) → C のみ（旧 overdue 相当）
assert.deepEqual(selectTasks(tasks, { groups:[g({ due:{mode:'range',from:null,to:-1} })] }, today).map(t=>t.id), ['3']);
// 期限=範囲(無制限〜0) → C のみ（旧 today 相当）
assert.deepEqual(selectTasks(tasks, { groups:[g({ due:{mode:'range',from:null,to:0} })] }, today).map(t=>t.id), ['3']);
// 期限=なし → D のみ
assert.deepEqual(selectTasks(tasks, { groups:[g({ due:{mode:'none'} })] }, today).map(t=>t.id), ['4']);
// 期限=範囲(無制限〜無制限) → 期限があるもの全部（旧 has 相当・期限昇順）
assert.deepEqual(selectTasks(tasks, { groups:[g({ due:{mode:'range',from:null,to:null} })], sort:'due' }, today).map(t=>t.id), ['3','1','2']);

// 完了=未完了のみ ＋ 期限昇順（期限なしは末尾）→ 旧 hideDone 相当
assert.deepEqual(selectTasks(tasks, { groups:[g({ done:{mode:'notDone',from:null,to:null} })], sort:'due' }, today).map(t=>t.id), ['1','2','4']);
// 完了=完了のみ・期間指定なし → C のみ
assert.deepEqual(selectTasks(tasks, { groups:[g({ done:{mode:'done',from:null,to:null} })] }, today).map(t=>t.id), ['3']);
// 完了=完了のみ・完了日が直近3日以内(-3〜0) → C（doneAt=-1日）
assert.deepEqual(selectTasks(tasks, { groups:[g({ done:{mode:'done',from:-3,to:0} })] }, today).map(t=>t.id), ['3']);
// 完了=完了のみ・完了日が10〜100日前 → 該当なし
assert.deepEqual(selectTasks(tasks, { groups:[g({ done:{mode:'done',from:-100,to:-10} })] }, today).map(t=>t.id), []);
// doneAt が無い完了タスクは、完了日の範囲指定に一致しない（期間指定なしなら一致する）
const noDoneAt = [{ id:'x', content:'X', done:true, createdAt:'2026-06-01T00:00:00Z' }];
assert.deepEqual(selectTasks(noDoneAt, { groups:[g({ done:{mode:'done',from:-30,to:0} })] }, today).map(t=>t.id), []);
assert.deepEqual(selectTasks(noDoneAt, { groups:[g({ done:{mode:'done',from:null,to:null} })] }, today).map(t=>t.id), ['x']);

// 優先度フィルタ
assert.deepEqual(selectTasks(tasks, { groups:[g({ prio:'3' })] }, today).map(t=>t.id), ['2']);

// 中項目（部分一致）フィルタ
const pj3 = [
  { id:'a', content:'A', proj:'p1', mid:'設計', createdAt:'2026-06-01T00:00:00Z' },
  { id:'b', content:'B', proj:'p1', mid:'実装', createdAt:'2026-06-02T00:00:00Z' },
  { id:'c', content:'C', proj:'p1',             createdAt:'2026-06-03T00:00:00Z' },
  { id:'d', content:'D', proj:'p1', mid:'設計', createdAt:'2026-06-04T00:00:00Z' },
];
assert.deepEqual(selectTasks(pj3, { groups:[g({ mid:'設計' })], sort:'title' }, today).map(t=>t.id), ['a','d']);
assert.deepEqual(selectTasks(pj3, { groups:[g({ mid:'設計' })], sort:'proj' }, today, { p1:0 }).map(t=>t.id), ['a','d'], 'プロジェクト並べ替えでも中項目フィルタは効く');

// projFilter（プロジェクト帰属）
const pj = [
  { id:'a', content:'A', proj:'p1', createdAt:'2026-06-01T00:00:00Z' },
  { id:'b', content:'B', proj:'p2', createdAt:'2026-06-02T00:00:00Z' },
  { id:'c', content:'C',            createdAt:'2026-06-03T00:00:00Z' }, // 未割当
];
assert.deepEqual(selectTasks(pj, { groups:[g({ proj:'p1' })], sort:'created' }, today).map(t=>t.id), ['a']);
assert.deepEqual(selectTasks(pj, { groups:[g({ proj:'none' })], sort:'created' }, today).map(t=>t.id), ['c']);
assert.deepEqual(selectTasks(pj, { groups:[g({ proj:'all' })],  sort:'created' }, today).map(t=>t.id), ['a','b','c']);

// プロジェクト単位の並び替え（projOrderで群順・群内は期限昇順・未割当は最後）
const pj2 = [
  { id:'x', content:'X', proj:'p2', due:'2026-06-20', createdAt:'2026-06-01T00:00:00Z' },
  { id:'y', content:'Y', proj:'p1', due:'2026-06-25', createdAt:'2026-06-02T00:00:00Z' },
  { id:'z', content:'Z',            createdAt:'2026-06-03T00:00:00Z' },                    // 未割当→最後
  { id:'w', content:'W', proj:'p1', due:'2026-06-22', createdAt:'2026-06-04T00:00:00Z' },
];
const order = { p1:0, p2:1 };
assert.deepEqual(selectTasks(pj2, { sort:'proj' }, today, order).map(t=>t.id), ['w','y','x','z']);
assert.deepEqual(selectTasks(pj2, { sort:'proj', sortDir:'desc' }, today, order).map(t=>t.id), ['w','y','x','z'], 'プロジェクト表示は昇降順トグルの影響を受けない');
// projOrder 未指定でも落ちない
assert.equal(selectTasks(pj2, { sort:'proj' }, today).length, 4);

// 優先度降順（高い順）: B(3) が先頭（既定 sortDir='asc' はこの並びをそのまま使う）
assert.equal(selectTasks(tasks, { sort:'priority' }, today)[0].id, '2');

// 作成日昇順
assert.deepEqual(selectTasks(tasks, { sort:'created' }, today).map(t=>t.id), ['1','2','3','4']);

// 並べ替え方向（降順）: due昇順の逆になる（期限なしの位置も含め一貫して反転）
assert.deepEqual(selectTasks(tasks, { sort:'due' }, today).map(t=>t.id), ['3','1','2','4'], '期限昇順（期限なしは末尾）');
assert.deepEqual(selectTasks(tasks, { sort:'due', sortDir:'desc' }, today).map(t=>t.id), ['4','2','1','3'], '期限降順（比較関数の符号反転＝期限なしの位置も反転）');

// 2グループのOR: 「1ヶ月以内に完了」OR「今後1週間が期限」を期限降順
const orResult = selectTasks(tasks, {
  groups: [
    g({ done:{mode:'done',from:-30,to:0} }),
    g({ due:{mode:'range',from:0,to:7} }),
  ],
  sort:'due', sortDir:'desc',
}, today);
assert.deepEqual(orResult.map(t=>t.id), ['1','3'], 'A(期限+1日)とC(完了)が該当・期限降順');

// ── viewToGroups: 保存済みビューのマイグレーション ──
assert.deepEqual(viewToGroups({})[0].due, { mode:'any', from:null, to:null }, '未指定/allはany');
assert.deepEqual(viewToGroups({ dueFilter:'next3' })[0].due, { mode:'range', from:0, to:3 });
assert.deepEqual(viewToGroups({ dueFilter:'overdue' })[0].due, { mode:'range', from:null, to:-1 });
assert.deepEqual(viewToGroups({ dueFilter:'today' })[0].due, { mode:'range', from:null, to:0 });
assert.deepEqual(viewToGroups({ dueFilter:'has' })[0].due, { mode:'range', from:null, to:null });
assert.deepEqual(viewToGroups({ dueFilter:'none' })[0].due, { mode:'none', from:null, to:null });
assert.deepEqual(viewToGroups({ hideDone:true })[0].done, { mode:'notDone', from:null, to:null });
assert.deepEqual(viewToGroups({})[0].done, { mode:'any', from:null, to:null });
assert.equal(viewToGroups({ projFilter:'p1' })[0].proj, 'p1');
assert.equal(viewToGroups({})[0].proj, 'all');
assert.equal(viewToGroups({ hideDone:true, dueFilter:'next3', projFilter:'p1' }).length, 1);

// 新形式（groups あり）はそのまま使う。欠けたフィールドは defaultGroup で補完
const passthrough = viewToGroups({ groups: [{ proj:'p9' }] });
assert.equal(passthrough.length, 1);
assert.equal(passthrough[0].proj, 'p9');
assert.deepEqual(passthrough[0].due, { mode:'any', from:null, to:null }, '欠けていたdueはdefaultGroupで補完');
assert.deepEqual(passthrough[0].mid, '');

console.log('PASS list.select');
