import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

// createCard は本体＋最初の付箋を同時生成する
const s = createStore();
const { body, ref } = s.createCard({ kind:'task', content:'見積を確認', proj:'b_pj1' });

assert.equal(body.kind, 'task');
assert.equal(body.content, '見積を確認');
assert.equal(body.proj, 'b_pj1');
assert.equal(body.done, undefined);
assert.ok(body.id.startsWith('b'));
assert.ok(body.createdAt, 'createdAt がある');

assert.equal(ref.bodyId, body.id);
assert.equal(ref.parentRefId, null);
assert.equal(ref.order, 0);
assert.ok(ref.id.startsWith('r'));

// get
assert.equal(s.getBody(body.id), body);
assert.equal(s.getRef(ref.id), ref);

// update は id を保持しつつ patch を当てる
s.updateBody(body.id, { done:true });
assert.equal(s.getBody(body.id).done, true);
assert.equal(s.getBody(body.id).id, body.id);

// id は本体・付箋で衝突しない（seq 共有・接頭辞で区別）
const c2 = s.createCard({ kind:'memo', content:'x' });
assert.notEqual(c2.body.id, body.id);
assert.notEqual(c2.ref.id, ref.id);

console.log('PASS store.core');
