import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

// (1) 通常: 付箋を消すと本体もGC（参照ゼロ）
let s = createStore();
const day = s.createCard({ kind:'day', content:'2026-06-16' });
const a = s.createCard({ kind:'task', content:'A', parentRefId: day.ref.id });
const a1 = s.createCard({ kind:'task', content:'A-1', parentRefId: a.ref.id });

s.deleteRef(a.ref.id);
// a と a1（子）の本体・付箋がすべて消える（連鎖）
assert.equal(s.getRef(a.ref.id), undefined);
assert.equal(s.getBody(a.body.id), undefined);
assert.equal(s.getRef(a1.ref.id), undefined, '子付箋も連鎖削除');
assert.equal(s.getBody(a1.body.id), undefined, '子本体もGC');
// day は残る
assert.ok(s.getBody(day.body.id));

// (2) ミラー: 2枚あるうち1枚を消しても本体は残る
s = createStore();
const x = s.createCard({ kind:'task', content:'X' });
const mirror = s.createRef({ bodyId: x.body.id, parentRefId: null });
s.deleteRef(mirror.id);
assert.ok(s.getBody(x.body.id), '参照がまだ1枚あるので本体は残る');
s.deleteRef(x.ref.id);
assert.equal(s.getBody(x.body.id), undefined, '最後の参照を消すとGC');

console.log('PASS store.gc');
