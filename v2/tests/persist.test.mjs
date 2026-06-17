import assert from 'node:assert/strict';
// 簡易 localStorage モック（node には無いため）
globalThis.localStorage = { _m:{}, getItem(k){return this._m[k]??null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
const { loadState, saveState } = await import('../src/persist.js');
const { createStore } = await import('../src/store.js');

assert.equal(loadState(), null, '初期は null');
const s = createStore();
s.createCard({ kind:'task', content:'保存テスト' });
saveState(s, { immediate:true });
const loaded = loadState();
assert.ok(loaded && loaded.bodies, '保存→読み込みで状態が戻る');
assert.equal(Object.keys(loaded.bodies).length, 1);

// 復元したストアは seq を引き継ぎ id が衝突しない
const s2 = createStore(loaded);
const before = Object.keys(loaded.bodies)[0];
const made = s2.createCard({ kind:'memo', content:'x' });
assert.notEqual(made.body.id, before);

console.log('PASS persist');
