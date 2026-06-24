import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const s = createStore();
const p = s.createProject('電子棚札');

// ルート参照が無ければ作る／あれば再利用（重複作成しない）
const page1 = s.ensureProjectPage(p.id);
assert.equal(page1.body.id, p.id);
assert.equal(page1.ref.parentRefId, null, 'ルート参照は parentRefId=null');
const page2 = s.ensureProjectPage(p.id);
assert.equal(page2.ref.id, page1.ref.id, '同じルート参照を再利用');
assert.equal(s.refsForBody(p.id).filter(r => r.parentRefId === null).length, 1);

// ページ配下にカードを作れる
const c = s.createCard({ kind:'memo', content:'会議メモ', parentRefId: page1.ref.id });
assert.equal(s.childRefs(page1.ref.id).length, 1);
assert.equal(s.childRefs(page1.ref.id)[0].id, c.ref.id);

// 不正な id / project でない body は null
assert.equal(s.ensureProjectPage('nope'), null, '不正idはnull');
const day = s.ensureDayCard('2026-06-24');
assert.equal(s.ensureProjectPage(day.body.id), null, 'project以外はnull');

// deleteProject はノートページ（ルート参照＋配下）も連鎖削除＋GC
const childBodyId = c.body.id;
s.deleteProject(p.id);
assert.equal(s.getBody(p.id), undefined, '本体削除');
assert.equal(s.getRef(page1.ref.id), undefined, 'ルート参照削除');
assert.equal(s.getRef(c.ref.id), undefined, '配下参照削除');
assert.equal(s.getBody(childBodyId), undefined, '配下カード本体もGC');

console.log('PASS store.projectpage');
