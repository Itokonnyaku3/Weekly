import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-06-18' });
s.createCard({ kind:'task', content:'A', parentRefId: day.ref.id });
let fired = 0; s.subscribe(() => fired++);

// GitHub取得などで状態を丸ごと差し替え
const remote = {
  v:1, seq:50,
  bodies:{ bX:{ id:'bX', kind:'task', content:'remote' } },
  refs:{ rX:{ id:'rX', bodyId:'bX', parentRefId:null, order:0 } },
  views:[{ id:'v1', name:'保存ビュー' }],
  savedAt:'2026-06-18T00:00:00Z',
};
s.replaceState(remote);
assert.ok(fired > 0, 'emit が発火する');
assert.equal(Object.keys(s.toJSON().bodies).length, 1);
assert.equal(s.getBody('bX').content, 'remote');
assert.equal(s.toJSON().savedAt, '2026-06-18T00:00:00Z');
assert.equal(s.listViews().length, 1);
assert.equal(s.getBody(day.body.id), undefined, '旧データは消える');

// seq を引き継ぐので新規IDが衝突しない
const made = s.createCard({ kind:'memo', content:'after' });
assert.equal(made.body.id, 'b51');

// views 無しの状態を渡しても落ちない（後方互換）
s.replaceState({ v:1, seq:0, bodies:{}, refs:{} });
assert.deepEqual(s.listViews(), []);

console.log('PASS store.replace');
