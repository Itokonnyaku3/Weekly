import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { serializeSubtree, encodeClipHtml, decodeClipHtml, insertNodes } from '../src/clipboard.js';

const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-07-03' });
// リンク付きカード＋子。子はメンション（@リンク先=リンク付きカード）を含む
const A = s.createCard({ kind:'memo', content:'A見出し', parentRefId: day.ref.id });
s.updateBody(A.body.id, { url:'https://example.com/a' });
const B = s.createCard({ kind:'memo', content:'前 ⟦' + A.body.id + '⟧ 後', parentRefId: A.ref.id });

const { nodes, plain } = serializeSubtree(s, A.ref.id);

// url が node に含まれる
assert.equal(nodes[0].url, 'https://example.com/a', 'url をシリアライズ');
// メンションは表示名に解決（plain / text）
assert.ok(nodes[1].text.includes('@A見出し'), 'メンションを表示名に解決(text)');
assert.ok(!nodes[1].text.includes('⟦'), '生マーカーは残らない(text)');
assert.ok(plain.includes('@A見出し') && !plain.includes('⟦'), 'plainもメンション解決');
// content(生)はJSON往復用に保持
assert.ok(nodes[1].content.includes('⟦' + A.body.id + '⟧'), 'contentは生マーカー保持');

// HTML: <a href> と入れ子 <ul>、マーカーを保持
const html = encodeClipHtml(nodes, plain);
assert.ok(html.includes('<a href="https://example.com/a">'), 'url→<a href>');
assert.ok(html.includes('<ul>') && html.includes('<li>'), '入れ子リスト');
assert.ok(html.includes('data-pwt2-clip='), 'マーカー保持（アプリ内往復）');
assert.ok(html.includes('@A見出し'), 'HTMLもメンション解決');

// 往復: decode→insert で url が保持される
const s2 = createStore();
const d2 = s2.createCard({ kind:'day', content:'d' });
const X = s2.createCard({ kind:'memo', content:'X', parentRefId: d2.ref.id });
insertNodes(s2, X.ref.id, decodeClipHtml(html));
const ARef = s2.childRefs(d2.ref.id).find(r => s2.getBody(r.bodyId).content === 'A見出し');
assert.ok(ARef, 'A見出しが復元');
assert.equal(s2.getBody(ARef.bodyId).url, 'https://example.com/a', 'url が往復で保持');

console.log('PASS clipboard.copy');
