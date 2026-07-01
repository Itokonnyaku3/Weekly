import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { collectMirrorRoots } from '../src/project.js';

const s = createStore();
const P = s.createProject('P');
const page = s.ensureProjectPage(P.id);

// (a) このPJのノートページ内のカード → 除外
s.createCard({ kind:'memo', content:'inpage', parentRefId: page.ref.id, proj: P.id });

// デイリー: PJタグ付きタスク＋その子（同PJ）→ 子は「別対象の子孫」で除外・親だけ拾う
const day = s.ensureDayCard('2026-06-30');
const t1 = s.createCard({ kind:'task', content:'t1', parentRefId: day.ref.id, proj: P.id });
s.createCard({ kind:'memo', content:'t1child', parentRefId: t1.ref.id, proj: P.id });

// 別の日の PJタグ付きメモ
const day2 = s.ensureDayCard('2026-06-29');
s.createCard({ kind:'memo', content:'m2', parentRefId: day2.ref.id, proj: P.id });

// 別PJのタスク → 除外
const Q = s.createProject('Q');
s.createCard({ kind:'task', content:'other', parentRefId: day.ref.id, proj: Q.id });

const roots = collectMirrorRoots(s, P.id, page.ref.id);
assert.deepEqual(roots.map(r => r.body.content).sort(), ['m2','t1'], 'ページ内・子孫・別PJは除外し最上位のみ');
const byName = Object.fromEntries(roots.map(r => [r.body.content, r.day]));
assert.equal(byName['t1'], '2026-06-30', '出所の日付');
assert.equal(byName['m2'], '2026-06-29');

// 出所の day が無い（別PJページ等）→ day=null
const r3 = createStore();
const P3 = r3.createProject('P3'); const pg3 = r3.ensureProjectPage(P3.id);
const orphanParent = r3.createCard({ kind:'memo', content:'orphanRoot' });   // 親なし（day配下でない）
r3.updateBody(orphanParent.body.id, { proj: P3.id });
const roots3 = collectMirrorRoots(r3, P3.id, pg3.ref.id);
assert.equal(roots3.length, 1);
assert.equal(roots3[0].day, null, 'day祖先が無ければ null');

console.log('PASS project.mirror');
