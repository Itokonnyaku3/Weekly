import assert from 'node:assert/strict';
import {
  TAG_RE, cardTags, TAG_SCHEMAS, schemaTagsInGroups,
  propColKey, parsePropColKey, propDef, propsPatch,
} from '../src/props.js';

// --- cardTags -----------------------------------------------------------

// 基本抽出
assert.deepEqual([...cardTags('A #請求処理 B')], ['請求処理']);

// 複数タグ
assert.deepEqual([...cardTags('資料 #設計 と #実装')].sort(), ['実装','設計']);

// タグなし→空Set
assert.deepEqual([...cardTags('タグなし')], []);
assert.equal(cardTags('タグなし').size, 0);

// null/undefined 安全
assert.deepEqual([...cardTags(null)], []);
assert.deepEqual([...cardTags(undefined)], []);
assert.deepEqual([...cardTags('')], []);

// # 連続や空白の扱い（TAG_RE は #⟦⟧ と空白を区切りとする）
assert.deepEqual([...cardTags('#a#b')].sort(), ['a','b']);
assert.deepEqual([...cardTags('# 先頭が空白')], []); // '#' 直後がスペース→空トークンなのでマッチしない
assert.deepEqual([...cardTags('文中#tag1 文中#tag2')].sort(), ['tag1','tag2']);

// TAG_RE 自体もエクスポートされていること
assert.ok(TAG_RE instanceof RegExp);

// --- TAG_SCHEMAS ----------------------------------------------------------

assert.ok(TAG_SCHEMAS['請求処理']);
assert.equal(TAG_SCHEMAS['請求処理'].props.length, 5);

const statusDef = TAG_SCHEMAS['請求処理'].props.find(p => p.key === 'status');
assert.ok(statusDef);
assert.equal(statusDef.type, 'select');
assert.deepEqual(statusDef.options, ['未着手','見積依頼中','発注済','請求処理中','支払済','完了']);
assert.equal(statusDef.options.length, 6);

const dateKeys = TAG_SCHEMAS['請求処理'].props.filter(p => p.type === 'date').map(p => p.key);
assert.deepEqual(dateKeys.sort(), ['bill','order','pay','quote'].sort());

// --- schemaTagsInGroups ----------------------------------------------------

// スキーマ無しタグは除外
assert.deepEqual(schemaTagsInGroups([{ tags:['設計'] }]), []);

// スキーマありは含まれる
assert.deepEqual(schemaTagsInGroups([{ tags:['請求処理'] }]), ['請求処理']);

// スキーマ有無混在→スキーマ有りのみ、出現順維持
assert.deepEqual(
  schemaTagsInGroups([{ tags:['設計','請求処理','実装'] }]),
  ['請求処理']
);

// 複数グループにまたがる重複排除・出現順維持
assert.deepEqual(
  schemaTagsInGroups([{ tags:['請求処理'] }, { tags:['設計','請求処理'] }]),
  ['請求処理']
);

// groups が空/undefined でも安全
assert.deepEqual(schemaTagsInGroups([]), []);
assert.deepEqual(schemaTagsInGroups(undefined), []);

// tags 無しの group でも安全
assert.deepEqual(schemaTagsInGroups([{}]), []);
assert.deepEqual(schemaTagsInGroups([{ tags:undefined }]), []);

// --- propColKey / parsePropColKey ------------------------------------------

// 往復一致
assert.equal(propColKey('請求処理','status'), 'p:請求処理:status');
assert.deepEqual(parsePropColKey(propColKey('請求処理','status')), { tag:'請求処理', key:'status' });

// タグ名に ':' が含まれても末尾区切りで正しく分離される
assert.equal(propColKey('a:b','key'), 'p:a:b:key');
assert.deepEqual(parsePropColKey('p:a:b:key'), { tag:'a:b', key:'key' });

// 'p:' 以外や不正形式は null
assert.equal(parsePropColKey('x:請求処理:status'), null);
assert.equal(parsePropColKey('請求処理:status'), null);
assert.equal(parsePropColKey('p:'), null);          // タグもキーも空
assert.equal(parsePropColKey('p:tag'), null);       // ':' が無い（区切りが無い）
assert.equal(parsePropColKey('p::key'), null);      // タグ名が空（i<=0）
assert.equal(parsePropColKey('p:tag:'), null);      // キーが空（i>=len-1）
assert.equal(parsePropColKey(123), null);           // 文字列以外
assert.equal(parsePropColKey(null), null);
assert.equal(parsePropColKey(undefined), null);

// --- propDef ----------------------------------------------------------------

// 存在するキー→定義
const def = propDef('請求処理','status');
assert.ok(def);
assert.equal(def.key, 'status');
assert.equal(def.label, 'ステータス');
assert.equal(def.type, 'select');

const dateDef = propDef('請求処理','quote');
assert.ok(dateDef);
assert.equal(dateDef.type, 'date');
assert.equal(dateDef.label, '見積日');

// 存在しないタグ→null
assert.equal(propDef('存在しないタグ','status'), null);

// 存在しないキー→null
assert.equal(propDef('請求処理','存在しないキー'), null);

// --- propsPatch --------------------------------------------------------------

// 新規セット
assert.deepEqual(propsPatch({}, 'status', '未着手'), { props: { status:'未着手' } });

// body.props が無い場合でも安全
assert.deepEqual(propsPatch({ content:'x' }, 'quote', '2026-07-01'), { props:{ quote:'2026-07-01' } });

// 上書き
assert.deepEqual(
  propsPatch({ props:{ status:'未着手' } }, 'status', '発注済'),
  { props:{ status:'発注済' } }
);

// 空文字でキー削除（他のキーは残る）
assert.deepEqual(
  propsPatch({ props:{ status:'発注済', quote:'2026-07-01' } }, 'status', ''),
  { props:{ quote:'2026-07-01' } }
);

// null/undefined でもキー削除
assert.deepEqual(
  propsPatch({ props:{ status:'発注済', quote:'2026-07-01' } }, 'status', null),
  { props:{ quote:'2026-07-01' } }
);
assert.deepEqual(
  propsPatch({ props:{ status:'発注済', quote:'2026-07-01' } }, 'quote', undefined),
  { props:{ status:'発注済' } }
);

// 最後のキー削除で props:undefined
assert.deepEqual(propsPatch({ props:{ status:'発注済' } }, 'status', ''), { props: undefined });

// 元々空でも空値指定で props:undefined
assert.deepEqual(propsPatch({}, 'status', ''), { props: undefined });

// イミュータブル: 元の body.props オブジェクトを破壊しない
{
  const original = { status:'発注済', quote:'2026-07-01' };
  const body = { props: original };
  const patch = propsPatch(body, 'status', '完了');
  assert.equal(original.status, '発注済', '元オブジェクトの値は変わらない');
  assert.deepEqual(original, { status:'発注済', quote:'2026-07-01' }, '元オブジェクト自体も変わらない');
  assert.notEqual(patch.props, original, '新しいオブジェクトが返る');
  assert.deepEqual(patch.props, { status:'完了', quote:'2026-07-01' });
}

console.log('PASS props');
