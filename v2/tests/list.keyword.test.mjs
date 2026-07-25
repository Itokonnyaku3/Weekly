import assert from 'node:assert/strict';
import { selectTasks, viewToGroups } from '../src/list.js';

const today = '2026-07-25';
// 条件グループの雛形（既定=すべて）に部分的な上書きをマージするヘルパ
const g = (patch) => ({
  keyword:'', due:{mode:'any',from:null,to:null}, done:{mode:'any',from:null,to:null},
  proj:'all', mid:'', prio:'all', tags:[], ...patch,
});
const tasks = [
  { id:'1', content:'見積書を作成 #請求処理', proj:'p1', createdAt:'2026-07-01T00:00:00Z' },
  { id:'2', content:'発注 Meeting の準備',    proj:'p2', createdAt:'2026-07-02T00:00:00Z' },
  { id:'3', content:'請求書を送付 #請求処理', proj:'p2', createdAt:'2026-07-03T00:00:00Z' },
  { id:'4', content:'meeting メモ整理',       proj:'p1', createdAt:'2026-07-04T00:00:00Z' },
];

// ── selectTasks: キーワード条件（本文の部分一致）──
assert.deepEqual(selectTasks(tasks, { groups:[g({ keyword:'請求' })], sort:'created' }, today).map(t=>t.id), ['1','3'], '本文の部分一致');
assert.deepEqual(selectTasks(tasks, { groups:[g({ keyword:'存在しない語' })], sort:'created' }, today).map(t=>t.id), [], '一致なしは0件');
// 大文字小文字は無視（キーワード側・本文側のどちらの綴りでも一致）
assert.deepEqual(selectTasks(tasks, { groups:[g({ keyword:'meeting' })], sort:'created' }, today).map(t=>t.id), ['2','4']);
assert.deepEqual(selectTasks(tasks, { groups:[g({ keyword:'MEETING' })], sort:'created' }, today).map(t=>t.id), ['2','4']);
// 空キーワードは条件なし＝全件。keyword を持たない旧グループ（undefined）でも同じ
assert.equal(selectTasks(tasks, { groups:[g({ keyword:'' })], sort:'created' }, today).length, 4);
assert.equal(selectTasks(tasks, { groups:[{ ...g({}), keyword: undefined }], sort:'created' }, today).length, 4);
// 本文が空のタスクでも落ちない（キーワード指定時は非該当）
assert.deepEqual(selectTasks([{ id:'e', content:'', createdAt:'2026-07-01T00:00:00Z' }], { groups:[g({ keyword:'x' })] }, today).map(t=>t.id), []);

// ── グループ内は AND（キーワード＋他条件）──
assert.deepEqual(selectTasks(tasks, { groups:[g({ keyword:'請求', tags:['請求処理'] })], sort:'created' }, today).map(t=>t.id), ['1','3'], 'キーワード＋タグのAND');
assert.deepEqual(selectTasks(tasks, { groups:[g({ keyword:'メモ', tags:['請求処理'] })], sort:'created' }, today).map(t=>t.id), [], 'タグ側で外れるとAND不成立');
assert.deepEqual(selectTasks(tasks, { groups:[g({ keyword:'請求', proj:'p2' })], sort:'created' }, today).map(t=>t.id), ['3'], 'キーワード＋PJのAND');
assert.deepEqual(selectTasks(tasks, { groups:[g({ keyword:'請求', proj:'none' })], sort:'created' }, today).map(t=>t.id), [], 'PJ側で外れるとAND不成立');

// ── グループ間は OR（キーワードA ＋ キーワードB）──
assert.deepEqual(selectTasks(tasks, {
  groups:[g({ keyword:'見積' }), g({ keyword:'メモ' })], sort:'created',
}, today).map(t=>t.id), ['1','4']);
// OR でも各グループ内は AND のまま
assert.deepEqual(selectTasks(tasks, {
  groups:[g({ keyword:'請求', proj:'p1' }), g({ keyword:'meeting', proj:'p2' })], sort:'created',
}, today).map(t=>t.id), ['1','2']);

// ── viewToGroups: keyword を持たない旧形式ビューへの補完（後方互換）──
assert.equal(viewToGroups({})[0].keyword, '', '空ビューでも keyword:""');
assert.equal(viewToGroups({ dueFilter:'next3', projFilter:'p1' })[0].keyword, '', '旧形式ビューには keyword:"" が補完される');
assert.equal(viewToGroups({ groups:[{ proj:'p1' }] })[0].keyword, '', 'keyword を持たない新形式グループにも補完');
assert.equal(viewToGroups({ groups:[{ keyword:'既存' }] })[0].keyword, '既存', '保存済みの keyword は上書きされない');

console.log('PASS list.keyword');
