import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const s = createStore();
assert.deepEqual(s.listProjects(), [], '初期は空');

const p1 = s.createProject('電子棚札');
assert.equal(p1.kind, 'project');
assert.equal(p1.content, '電子棚札');
const p2 = s.createProject('冷ケース');
assert.equal(s.listProjects().length, 2);

// 改名は updateBody
s.updateBody(p1.id, { content: '電子棚札 導入' });
assert.equal(s.getBody(p1.id).content, '電子棚札 導入');

// タスクに帰属
const day = s.createCard({ kind:'day', content:'2026-06-18' });
const t = s.createCard({ kind:'task', content:'見積', parentRefId: day.ref.id });
s.updateBody(t.body.id, { proj: p1.id });
assert.equal(s.getBody(t.body.id).proj, p1.id);

// プロジェクト削除でタスクの帰属が外れ、本体も消える
s.deleteProject(p1.id);
assert.equal(s.listProjects().length, 1);
assert.equal(s.getBody(p1.id), undefined);
assert.equal(s.getBody(t.body.id).proj, undefined, '帰属が外れる');

// プロジェクトは付箋を持たない（GC対象外・明示削除のみ）
assert.equal(s.refsForBody(p2.id).length, 0);

// 永続化 round-trip
const s2 = createStore(JSON.parse(JSON.stringify(s.toJSON())));
assert.equal(s2.listProjects().length, 1);
assert.equal(s2.listProjects()[0].content, '冷ケース');

// 並べ替え（moveProject）: 表示順の隣と入れ替え＋永続
const s3 = createStore();
const a = s3.createProject('A'), b = s3.createProject('B'), c = s3.createProject('C');
assert.deepEqual(s3.listProjects().map(p=>p.content), ['A','B','C'], '初期は作成順');
assert.equal(s3.moveProject(c.id, -1), true);
assert.deepEqual(s3.listProjects().map(p=>p.content), ['A','C','B'], 'C を上へ');
assert.equal(s3.moveProject(a.id, +1), true);
assert.deepEqual(s3.listProjects().map(p=>p.content), ['C','A','B'], 'A を下へ');
assert.equal(s3.moveProject(c.id, -1), false, '先頭はそれ以上上げられない');
const s4 = createStore(JSON.parse(JSON.stringify(s3.toJSON())));
assert.deepEqual(s4.listProjects().map(p=>p.content), ['C','A','B'], '並べ替えは永続');

console.log('PASS store.projects');
