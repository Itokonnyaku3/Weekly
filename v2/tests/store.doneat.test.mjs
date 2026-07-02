import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const s = createStore();
const { body } = s.createCard({ kind:'task', content:'見積' });
assert.equal(body.doneAt, undefined, '作成直後は doneAt 無し');

// 未完了→完了: doneAt が記録される
s.updateBody(body.id, { done:true });
const afterDone = s.getBody(body.id);
assert.equal(afterDone.done, true);
assert.ok(afterDone.doneAt, 'doneAt が記録される');
assert.ok(!Number.isNaN(Date.parse(afterDone.doneAt)), 'doneAt はISO日時として解釈できる');

// 完了→未完了: doneAt が消える
s.updateBody(body.id, { done:false });
assert.equal(s.getBody(body.id).done, false);
assert.equal(s.getBody(body.id).doneAt, undefined, 'doneAt が消える');

// done を含まない更新では doneAt は変化しない
s.updateBody(body.id, { done:true });
const stamped = s.getBody(body.id).doneAt;
s.updateBody(body.id, { content:'見積(改)' });
assert.equal(s.getBody(body.id).doneAt, stamped, 'doneAt を含まない更新では変化しない');

// 既に完了中に done:true を再度送っても doneAt は上書きされない（連打対策）
s.updateBody(body.id, { done:true });
assert.equal(s.getBody(body.id).doneAt, stamped, '既に完了中の再度の done:true では doneAt は据え置き');

console.log('PASS store.doneat');
