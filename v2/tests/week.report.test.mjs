import assert from 'node:assert/strict';
import { buildWeekReport } from '../src/week.js';

// buildWeeklyGrid の結果の形を最小限で作る（描画に依存しない純関数のテスト）
const e = (content, extra = {}) => ({ ref:{ id:'r' }, body:{ content, ...extra }, day:'2026-07-22', wk:'2026-07-20' });
const cell = (o = {}) => ({ ms:[], todo:[], done:[], memo:[], over:[], ...o });
const grid = {
  weeks: [{ wk:'2026-07-20', label:'7/20〜7/26', isCurrent:true }],
  rows: [
    { projId:'p1', proj:{ content:'PJ.HACCP' }, kids:[], links:[], total:4, cells:{
      '2026-07-20': cell({
        ms:   [e('運用開始 #マイルストーン')],
        done: [e('SP外部社と打合せ')],
        todo: [e('標準温度の確認')],
        memo: [e('議事録: キックオフ')],
        over: [{ ...e('見積依頼'), wk:'2026-07-13' }],
      }),
    }},
    { projId:'p2', proj:{ content:'PJ.Empty' }, kids:[], links:[], total:0, cells:{ '2026-07-20': cell() }},
    { projId:null, proj:null, kids:[], links:[], total:1, cells:{
      '2026-07-20': cell({ todo:[e('割当漏れ')] }) }},
  ],
};

const r = buildWeekReport(grid, '2026-07-20');

// プレーンテキスト
assert.match(r.plain, /^週次レポート 7\/20〜7\/26\n/, '先頭は週ラベル');
assert.match(r.plain, /■ PJ\.HACCP/);
assert.match(r.plain, /【マイルストーン】\n\s+🏁 運用開始/, 'タグは表示から除く');
assert.match(r.plain, /【やったこと】\n\s+・SP外部社と打合せ/);
assert.match(r.plain, /【やること】\n\s+・標準温度の確認/);
assert.match(r.plain, /【メモ】\n\s+・議事録: キックオフ/);
assert.match(r.plain, /【期限切れ】\n\s+・見積依頼（7\/13週）/, '期限切れは元の週を添える');
assert.match(r.plain, /■ 未割当/, '未割当行も出す');
assert.equal(r.plain.includes('PJ.Empty'), false, '中身の無いPJは出さない');

// ブロック順は マイルストーン → やったこと → やること → メモ → 期限切れ
const order = ['【マイルストーン】', '【やったこと】', '【やること】', '【メモ】', '【期限切れ】']
  .map(k => r.plain.indexOf(k));
assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'ブロックの順序が固定されている');

// HTML（メール/OneNote貼付用）
assert.match(r.html, /<h3>PJ\.HACCP<\/h3>/);
assert.match(r.html, /<li>標準温度の確認<\/li>/);
assert.equal(r.html.includes('<script'), false);

// HTMLエスケープ（本文に < > & が入っても壊れない）
const g2 = { weeks:[{ wk:'2026-07-20', label:'7/20〜7/26', isCurrent:true }],
  rows:[{ projId:'p1', proj:{ content:'A & B' }, kids:[], links:[], total:1,
    cells:{ '2026-07-20': cell({ todo:[e('<b>危険</b>')] }) } }] };
const r2 = buildWeekReport(g2, '2026-07-20');
assert.match(r2.html, /A &amp; B/);
assert.match(r2.html, /&lt;b&gt;危険&lt;\/b&gt;/);
assert.match(r2.plain, /・<b>危険<\/b>/, 'プレーンはそのまま');

// 該当週が無ければ空文字（クラッシュしない）
const r3 = buildWeekReport(grid, '2099-01-04');
assert.equal(r3.plain, '');
assert.equal(r3.html, '');

console.log('PASS week.report');
