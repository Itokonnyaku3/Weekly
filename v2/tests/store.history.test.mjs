import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

// commitHistory() でバースト境界を明示し、1ステップずつ検証する
const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-06-30' });
s.commitHistory();
const a = s.createCard({ kind:'memo', content:'A', parentRefId: day.ref.id });
s.commitHistory();
s.updateBody(a.body.id, { content:'A2' });
s.commitHistory();

assert.equal(s.getBody(a.body.id).content, 'A2');
assert.equal(s.canUndo(), true);
assert.equal(s.canRedo(), false);

// undo: A2 → A
assert.equal(s.undo(), true);
assert.equal(s.getBody(a.body.id).content, 'A');
assert.equal(s.canRedo(), true);

// undo: カード A の作成を取り消し（本体ごと消える）
assert.equal(s.undo(), true);
assert.equal(s.getBody(a.body.id), undefined);

// redo: A 復活
assert.equal(s.redo(), true);
assert.equal(s.getBody(a.body.id).content, 'A');
// redo: A2 復活
assert.equal(s.redo(), true);
assert.equal(s.getBody(a.body.id).content, 'A2');
assert.equal(s.canRedo(), false);

// 新しい変更で redo は無効化される
s.undo();                                  // A2 → A
assert.equal(s.canRedo(), true);
s.updateBody(a.body.id, { content:'B' }); s.commitHistory();
assert.equal(s.canRedo(), false, '新しい変更で redo スタックがクリアされる');

// 連続変更（コミット境界なし）は 1 ステップにまとまる
const s2 = createStore();
const d2 = s2.createCard({ kind:'day', content:'d' }); s2.commitHistory();
const c = s2.createCard({ kind:'memo', content:'x', parentRefId: d2.ref.id });
s2.updateBody(c.body.id, { content:'xy' });
s2.updateBody(c.body.id, { content:'xyz' });   // ここまで境界なし＝1バースト
s2.undo();                                      // バーストを丸ごと取り消し → カードごと消える
assert.equal(s2.getBody(c.body.id), undefined, '連続変更は1ステップで取り消し');

// replaceState は履歴をリセットする
const s3 = createStore();
const d3 = s3.createCard({ kind:'day', content:'d' }); s3.commitHistory();
s3.replaceState({ v:1, seq:0, bodies:{}, refs:{}, views:[] });
assert.equal(s3.canUndo(), false, 'replaceState 後は取り消し不可');

console.log('PASS store.history');
