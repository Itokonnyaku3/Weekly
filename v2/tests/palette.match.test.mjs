import assert from 'node:assert/strict';
import { kanaToRomaji, matchCommand } from '../src/palette.js';

// kanaToRomaji: ひらがな/カタカナ/促音/長音/拗音
assert.equal(kanaToRomaji('ひょうじ'), 'hyouji');
assert.equal(kanaToRomaji('デイリー'), 'deiri');      // 長音は無視
assert.equal(kanaToRomaji('きょう'), 'kyou');
assert.equal(kanaToRomaji('がっこう'), 'gakkou');     // 促音は次子音を重ねる
assert.equal(kanaToRomaji('プロジェクト'), 'purojekuto');
assert.equal(kanaToRomaji('abc'), 'abc');            // 英数はそのまま

// matchCommand: ローマ字直接
const c = { label:'デイリーを表示', cat:'表示', roma:'deiri hyouji daily' };
assert.equal(matchCommand(c, 'hyouji', 'hyouji'), true, 'ローマ字で一致');
assert.equal(matchCommand(c, 'daily', 'daily'), true, '英単語で一致');
assert.equal(matchCommand(c, 'deiri', 'deiri'), true);
assert.equal(matchCommand(c, 'zzz', 'zzz'), false, '不一致');

// matchCommand: 原文（漢字/かな）直接一致
assert.equal(matchCommand(c, 'デイリー'.toLowerCase(), kanaToRomaji('デイリー')), true, 'ラベル部分一致');
assert.equal(matchCommand(c, '表示', kanaToRomaji('表示')), true, 'カテゴリ一致');

// matchCommand: かな入力（IMEオン時）→ ローマ字化して roma に一致
assert.equal(matchCommand(c, 'ひょうじ', kanaToRomaji('ひょうじ')), true, 'かな→ローマ字化で一致');

// ワープロ式のゆらぎ（tuika ↔ tsuika, si ↔ shi）
const t = { label:'今日に追加', cat:'追加', roma:'kyou tsuika today add' };
assert.equal(matchCommand(t, 'tsuika', kanaToRomaji('tsuika')), true, 'ヘボン式');
assert.equal(matchCommand(t, 'tuika', kanaToRomaji('tuika')), true, 'ワープロ式');
const h = { label:'完了を隠す', cat:'表示', roma:'kanryou hyouji kakusu done hide show' };
assert.equal(matchCommand(h, 'kakusi', kanaToRomaji('kakusi')), false, 'kakusuは別語');
assert.equal(matchCommand(h, 'kakusu', kanaToRomaji('kakusu')), true);

// 空クエリは全件通過
assert.equal(matchCommand(c, '', ''), true);

console.log('PASS palette.match');
