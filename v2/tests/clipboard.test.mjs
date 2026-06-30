import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { serializeSubtree, encodeClipHtml, decodeClipHtml, parsePlainText, insertNodes, looksLikeTsv, tsvToRows, detectInlineFormat } from '../src/clipboard.js';

// A > A1(task,done,prio3,due) > A2
const s = createStore();
const day = s.createCard({ kind:'day', content:'2026-06-20' });
const A  = s.createCard({ kind:'memo', content:'A', parentRefId: day.ref.id });
const A1 = s.createCard({ kind:'task', content:'A1', done:true, prio:3, due:'2026-06-25', parentRefId: A.ref.id });
s.createCard({ kind:'memo', content:'A2', parentRefId: A1.ref.id });

// serialize
const { nodes, plain } = serializeSubtree(s, A.ref.id);
assert.deepEqual(nodes.map(n => [n.content, n.depth]), [['A',0],['A1',1],['A2',2]]);
assert.equal(plain, 'A\n\tA1\n\t\tA2');
assert.equal(nodes[1].kind, 'task'); assert.equal(nodes[1].done, true);
assert.equal(nodes[1].prio, 3); assert.equal(nodes[1].due, '2026-06-25');

// encode/decode roundtrip
const html = encodeClipHtml(nodes, plain);
assert.ok(html.includes('data-pwt2-clip='));
assert.deepEqual(decodeClipHtml(html), nodes);
assert.equal(decodeClipHtml('<p>no marker</p>'), null);

// parsePlainText（タブ=1段 / 2スペース=1段 / 空行無視）
const p = parsePlainText('A\n\tB\n\t\tC\n  D\n\n');
assert.deepEqual(p.map(n => [n.content, n.depth]), [['A',0],['B',1],['C',2],['D',1]]);
assert.equal(p[0].kind, 'memo');

// insertNodes（P(0),P1(1),P2(0)）を X の後ろへ
const s2 = createStore();
const d2 = s2.createCard({ kind:'day', content:'d' });
const X = s2.createCard({ kind:'memo', content:'X', parentRefId: d2.ref.id });
insertNodes(s2, X.ref.id, [
  { content:'P', depth:0, kind:'memo' },
  { content:'P1', depth:1, kind:'task', done:true },
  { content:'P2', depth:0, kind:'memo' },
]);
assert.deepEqual(s2.childRefs(d2.ref.id).map(r => s2.getBody(r.bodyId).content), ['X','P','P2']);
const pRef = s2.childRefs(d2.ref.id).find(r => s2.getBody(r.bodyId).content === 'P');
assert.deepEqual(s2.childRefs(pRef.id).map(r => s2.getBody(r.bodyId).content), ['P1']);
assert.equal(s2.getBody(s2.childRefs(pRef.id)[0].bodyId).done, true);

// 構造ごとの往復（serialize→encode→decode→insert）
const decoded = decodeClipHtml(encodeClipHtml(serializeSubtree(s, A.ref.id).nodes, ''));
const s3 = createStore();
const d3 = s3.createCard({ kind:'day', content:'d' });
const Y = s3.createCard({ kind:'memo', content:'Y', parentRefId: d3.ref.id });
insertNodes(s3, Y.ref.id, decoded);
const ARef = s3.childRefs(d3.ref.id).find(r => s3.getBody(r.bodyId).content === 'A');
const A1Ref = s3.childRefs(ARef.id)[0];
assert.equal(s3.getBody(A1Ref.bodyId).content, 'A1');
assert.equal(s3.getBody(A1Ref.bodyId).prio, 3);
assert.equal(s3.getBody(s3.childRefs(A1Ref.id)[0].bodyId).content, 'A2');

// TSV 判定（セル区切りタブ=表 / 先頭インデントのみ=非表）とパース
assert.equal(looksLikeTsv('a\tb\nc\td'), true, 'セル間タブ→TSV');
assert.equal(looksLikeTsv('x\ty'), true, '1行でもセル間タブ→TSV');
assert.equal(looksLikeTsv('A\n\tB\n\t\tC'), false, '先頭インデントのみ→非TSV(アウトライン)');
assert.equal(looksLikeTsv('ただの一行'), false, 'タブ無し→非TSV');
assert.deepEqual(tsvToRows('項目\t担当\n電波\t楽天'), [['項目','担当'],['電波','楽天']]);

// detectInlineFormat（DOM非依存の分岐: 裸URLは url を、普通のプレーンは書式なし）
assert.equal(detectInlineFormat('', 'https://example.com/x').url, 'https://example.com/x', '裸URL→url');
const f0 = detectInlineFormat('', 'ただのテキスト');
assert.equal(f0.url, undefined); assert.equal(f0.bold, undefined); assert.equal(f0.color, undefined);
assert.equal(detectInlineFormat('', 'これは https://a.com を含む文').url, undefined, '文中URLは単独でないので拾わない');
assert.equal(detectInlineFormat('', '  https://b.com/y  ').url, 'https://b.com/y', '前後空白は許容');

console.log('PASS clipboard');
