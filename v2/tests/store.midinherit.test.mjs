import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-07-03' });

// メモ配下に作ったカード → 親メモ content が mid に（作成時1回）
const memo = s.createCard({ kind:'memo', content:'見積フェーズ', parentRefId: day.ref.id });
const child = s.createCard({ kind:'memo', content:'子', parentRefId: memo.ref.id });
assert.equal(s.getBody(child.body.id).mid, '見積フェーズ', 'メモ配下→親メモ名を継承');

// day 直下は継承しない
const top = s.createCard({ kind:'memo', content:'直下', parentRefId: day.ref.id });
assert.equal(s.getBody(top.body.id).mid, undefined, 'day直下は継承しない');

// project 直下は継承しない
const proj = s.createProject('PJ');
const page = s.ensureProjectPage(proj.id);
const pchild = s.createCard({ kind:'memo', content:'PJ子', parentRefId: page.ref.id });
assert.equal(s.getBody(pchild.body.id).mid, undefined, 'project直下は継承しない');

// 明示 mid 指定は尊重
const explicit = s.createCard({ kind:'memo', content:'明示', mid:'手動', parentRefId: memo.ref.id });
assert.equal(s.getBody(explicit.body.id).mid, '手動', '明示midを尊重');

// 親メモが空 content → 継承しない
const emptyMemo = s.createCard({ kind:'memo', content:'', parentRefId: day.ref.id });
const underEmpty = s.createCard({ kind:'memo', content:'x', parentRefId: emptyMemo.ref.id });
assert.equal(s.getBody(underEmpty.body.id).mid, undefined, '親メモ空→継承しない');

// 作成後に親メモをリネームしても子の mid は不変（作成時スナップショット）
s.updateBody(memo.body.id, { content:'見積フェーズ(改)' });
assert.equal(s.getBody(child.body.id).mid, '見積フェーズ', '親リネーム後も子midは不変');

console.log('PASS store.midinherit');
