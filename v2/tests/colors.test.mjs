import assert from 'node:assert/strict';
import { projColor, tintRgba, PROJ_PALETTE, PROJ_NONE_COLOR } from '../src/colors.js';

// ── projColor: id から安定した色（リストの見出しと週次の行背景で同じ色になることが前提）──
assert.equal(projColor('b12'), projColor('b12'), '同じidなら常に同じ色');
assert.ok(PROJ_PALETTE.includes(projColor('b12')), 'パレット内の色を返す');
assert.equal(projColor(null), PROJ_NONE_COLOR, '未割当（null）はグレー');
assert.equal(projColor(''), PROJ_NONE_COLOR, '未割当（空文字）はグレー');
assert.equal(projColor(undefined), PROJ_NONE_COLOR, '未割当（undefined）はグレー');

// パレットが偏らない（10色に対し十分な種類が出る）
const seen = new Set();
for (let i = 0; i < 200; i++) seen.add(projColor('b' + i));
assert.ok(seen.size >= 8, '200件で8色以上に散る（実際: ' + seen.size + '）');

// ── tintRgba: 半透明で重ねるための色。壊れた入力で描画を壊さない ──
assert.equal(tintRgba('#b5683a', 0.1), 'rgba(181,104,58,0.1)');
assert.equal(tintRgba('b5683a', 0.18), 'rgba(181,104,58,0.18)', '# なしも解釈する');
assert.equal(tintRgba('#B5683A', 0.1), 'rgba(181,104,58,0.1)', '大文字も解釈する');
assert.equal(tintRgba(' #b5683a ', 0.1), 'rgba(181,104,58,0.1)', '前後の空白を無視');
assert.equal(tintRgba('#000000', 0.5), 'rgba(0,0,0,0.5)');
assert.equal(tintRgba('#ffffff', 0.5), 'rgba(255,255,255,0.5)');
// 不正値 → transparent（色付けなしにフォールバック＝背景が消えない）
for (const bad of ['bad', '#fff', '', null, undefined, '#12345g', 123]){
  assert.equal(tintRgba(bad, 0.1), 'transparent', '不正値は transparent: ' + String(bad));
}
// alpha のクランプ
assert.equal(tintRgba('#000000', 5), 'rgba(0,0,0,1)', 'alpha 上限は1');
assert.equal(tintRgba('#ffffff', -1), 'rgba(255,255,255,0)', 'alpha 下限は0');

console.log('colors.test.mjs OK');
