import assert from 'node:assert/strict';
import { isTitleAllowedKey } from '../src/daily.js';

// ズーム/PJページの見出し行で受け付けるキーの判定。
// 見出しはカードではなくページの器なので、構造を変えるキーは通さない。
{
  const K = (key, mod = {}) => ({ key, altKey:false, ctrlKey:false, metaKey:false, shiftKey:false, ...mod });
  // 許可: ナビとコンテンツ挿入
  assert.equal(isTitleAllowedKey(K('ArrowUp',   { altKey:true })), true,  'Alt+↑ でズームを出る');
  assert.equal(isTitleAllowedKey(K('/',         { ctrlKey:true })), true, 'Ctrl+/ で日付挿入');
  assert.equal(isTitleAllowedKey(K('@')),         true, '@ でメンション');
  assert.equal(isTitleAllowedKey(K('#')),         true, '# でタグ');
  assert.equal(isTitleAllowedKey(K('ArrowDown')), true, '↓ で子カードへ');
  assert.equal(isTitleAllowedKey(K('ArrowLeft')), true, '← でチップ移動');
  assert.equal(isTitleAllowedKey(K('Escape')),    true, 'Esc');
  // 拒否: 構造を変えるもの
  assert.equal(isTitleAllowedKey(K('Enter')),     false, 'Enter は分割しない');
  assert.equal(isTitleAllowedKey(K('Enter', { ctrlKey:true })),  false, 'Ctrl+Enter でタスク化しない');
  assert.equal(isTitleAllowedKey(K('Tab')),       false, 'Tab はインデントしない');
  assert.equal(isTitleAllowedKey(K('Tab', { shiftKey:true })),   false, 'Shift+Tab もしない');
  assert.equal(isTitleAllowedKey(K('Backspace', { shiftKey:true, ctrlKey:true })), false, 'ページを削除しない');
  assert.equal(isTitleAllowedKey(K('ArrowUp', { altKey:true, shiftKey:true })),    false, '並べ替えない');
  assert.equal(isTitleAllowedKey(K('ArrowUp', { ctrlKey:true })), false, 'カスケード開閉しない');
}

console.log('PASS daily.titlekey');
