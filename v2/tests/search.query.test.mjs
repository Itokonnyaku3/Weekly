import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { runQuery } from '../src/search.js';

const today = '2026-07-05';
const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-07-05' });
// 親 #設計 > 子 #設計（両方一致）→ 親だけ返す（重複除外）
const parent = s.createCard({ kind:'memo', content:'親 #設計', parentRefId: day.ref.id });
s.createCard({ kind:'memo', content:'子 #設計', parentRefId: parent.ref.id });
// 別の一致（独立）
s.createCard({ kind:'task', content:'単体 #設計', parentRefId: day.ref.id });
// 非該当
s.createCard({ kind:'memo', content:'無関係', parentRefId: day.ref.id });

const roots = runQuery(s, { tags:['設計'] }, today);
const contents = roots.map(r => r.body.content).sort();
assert.deepEqual(contents, ['単体 #設計','親 #設計'], '親配下の一致は親だけ・独立一致は別で計2件');
assert.ok(roots.every(r => r.ref && r.body), '各要素は {ref, body}');

// 条件に一致しなければ空
assert.deepEqual(runQuery(s, { keyword:'該当なしzz' }, today), []);

console.log('PASS search.query');
