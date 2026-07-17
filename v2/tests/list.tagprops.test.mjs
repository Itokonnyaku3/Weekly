import assert from 'node:assert/strict';
import { selectTasks, viewToGroups, composeColumns, DEFAULT_COLUMNS } from '../src/list.js';

const today = '2026-07-17';
// 条件グループの雛形（既定=すべて・タグなし）に部分的な上書きをマージするヘルパ
const g = (patch) => ({
  due:{mode:'any',from:null,to:null}, done:{mode:'any',from:null,to:null},
  proj:'all', mid:'', prio:'all', tags:[], ...patch,
});
const tasks = [
  { id:'1', content:'見積 #請求処理',        createdAt:'2026-07-01T00:00:00Z' },
  { id:'2', content:'発注 #請求処理 #A社',   createdAt:'2026-07-02T00:00:00Z' },
  { id:'3', content:'タグなし',              createdAt:'2026-07-03T00:00:00Z' },
  { id:'4', content:'別件 #A社',             createdAt:'2026-07-04T00:00:00Z' },
];

// ── selectTasks: タグ条件 ──
// 単一タグ一致
assert.deepEqual(selectTasks(tasks, { groups:[g({ tags:['請求処理'] })], sort:'created' }, today).map(t=>t.id), ['1','2']);
// 不一致（誰も持たないタグ）
assert.deepEqual(selectTasks(tasks, { groups:[g({ tags:['存在しない'] })], sort:'created' }, today).map(t=>t.id), []);
// 複数タグは AND（両方持つタスクだけ）
assert.deepEqual(selectTasks(tasks, { groups:[g({ tags:['請求処理','A社'] })], sort:'created' }, today).map(t=>t.id), ['2']);
// tags:[] は条件なし（全件）
assert.equal(selectTasks(tasks, { groups:[g({})], sort:'created' }, today).length, 4);
// OR は複数グループで表現
assert.deepEqual(selectTasks(tasks, {
  groups:[g({ tags:['請求処理'] }), g({ tags:['A社'] })], sort:'created',
}, today).map(t=>t.id), ['1','2','4']);
// tags を持たない旧グループ（undefined）でも安全＝条件なし
assert.equal(selectTasks(tasks, { groups:[{ ...g({}), tags: undefined }], sort:'created' }, today).length, 4);

// ── viewToGroups: tags を持たない旧形式ビューへの補完 ──
assert.deepEqual(viewToGroups({ dueFilter:'next3' })[0].tags, [], '旧形式ビューには tags:[] が補完される');
assert.deepEqual(viewToGroups({ groups:[{ proj:'p1' }] })[0].tags, [], 'tags を持たない新形式グループにも補完');
assert.deepEqual(viewToGroups({})[0].tags, [], '空ビューでも tags:[]');

// ── composeColumns: 動的列の合成 ──
const PK = 'p:請求処理:';
const ALLP = ['quote','order','bill','pay','status'].map(k => PK + k);   // スキーマ定義順
// stored 空/null → DEFAULT_COLUMNS（schemaTags があってもプロパティ列は増えない）
assert.deepEqual(composeColumns(null, []), DEFAULT_COLUMNS);
assert.deepEqual(composeColumns([], ['請求処理']), DEFAULT_COLUMNS);
// プロパティ列は due の後・created の前
assert.deepEqual(
  composeColumns(['title','due','created', PK+'quote'], ['請求処理']),
  ['title','due', PK+'quote', 'created']);
// 作成日が非表示でもプロパティ列は due の後（末尾）
assert.deepEqual(
  composeColumns(['title','due', PK+'status'], ['請求処理']),
  ['title','due', PK+'status']);
// stored に無いプロパティ列は出ない・並びはスキーマ定義順（stored の順ではない）
assert.deepEqual(
  composeColumns(['title', PK+'status', PK+'quote'], ['請求処理']),
  ['title', PK+'quote', PK+'status']);
// title は常に強制追加
assert.deepEqual(composeColumns(['due'], []), ['title','due']);
// schemaTags に現存しないタグの 'p:' キーは無視（古い残骸）
assert.deepEqual(composeColumns(['title', PK+'quote'], []), ['title']);
assert.deepEqual(composeColumns(['title','p:未知タグ:quote'], ['請求処理']), ['title']);
// 全列指定: 静的列は COLUMN_ORDER の順のまま・プロパティ列一式が due と created の間
assert.deepEqual(
  composeColumns(['created','due','priority','title','status','mid','project', ...ALLP], ['請求処理']),
  ['project','mid','status','title','priority','due', ...ALLP, 'created']);

console.log('PASS list.tagprops');
