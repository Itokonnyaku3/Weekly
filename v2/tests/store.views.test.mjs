import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const s = createStore();
assert.deepEqual(s.listViews(), [], '初期は空');

const v = s.saveView({ name:'直近3日', hideDone:true, dueFilter:'next3', sort:'due', columns:['status','title','due'] });
assert.ok(v.id.startsWith('v'));
assert.equal(s.listViews().length, 1);
assert.equal(s.listViews()[0].name, '直近3日');
assert.deepEqual(s.listViews()[0].columns, ['status','title','due']);
assert.equal(s.listViews()[0].dueFilter, 'next3');

// 更新（id 保持）
s.updateView(v.id, { name:'直近3日(更新)' });
assert.equal(s.listViews()[0].name, '直近3日(更新)');
assert.equal(s.listViews()[0].id, v.id);

// 2件目→削除
const v2 = s.saveView({ name:'PJ別', sort:'priority' });
assert.equal(s.listViews().length, 2);
s.deleteView(v.id);
assert.equal(s.listViews().length, 1);
assert.equal(s.listViews()[0].id, v2.id);

// 永続化 round-trip（toJSON に views が含まれ、復元できる）
const dumped = JSON.parse(JSON.stringify(s.toJSON()));
const s2 = createStore(dumped);
assert.equal(s2.listViews().length, 1);
assert.equal(s2.listViews()[0].name, 'PJ別');

// 後方互換: views 無しの状態を渡しても落ちない
const s3 = createStore({ v:1, seq:0, bodies:{}, refs:{} });
assert.deepEqual(s3.listViews(), []);

console.log('PASS store.views');
