import assert from 'node:assert/strict';
import {
  defaultGroup, toGroups,
  keywordMatch, tagsMatch, projMatch, midMatch, prioMatch,
  dueGroupMatch, doneGroupMatch,
  matchGroup, matchQuery,
  groupToFlatQuery, flatQueryToGroup,
} from '../src/query.js';

const today = '2026-07-05';
const b = (o) => Object.assign({ kind:'task', content:'', proj:undefined, due:'', prio:0, done:false }, o);

// --- defaultGroup -----------------------------------------------------------

{
  const g = defaultGroup();
  assert.equal(g.keyword, '');
  assert.deepEqual(g.tags, []);
  assert.equal(g.proj, 'all');
  assert.equal(g.mid, '');
  assert.deepEqual(g.due, { mode:'any', from:null, to:null });
  assert.deepEqual(g.done, { mode:'any', from:null, to:null });
  assert.equal(g.prio, 'all');
}

// 呼ぶたびに別オブジェクト（状態共有バグ防止）
{
  const g1 = defaultGroup();
  const g2 = defaultGroup();
  assert.notEqual(g1, g2);
  assert.notEqual(g1.tags, g2.tags);
  assert.notEqual(g1.due, g2.due);
  assert.notEqual(g1.done, g2.done);
  g1.tags.push('x');
  g1.due.from = 1;
  assert.deepEqual(g2.tags, []);
  assert.equal(g2.due.from, null);
}

// --- toGroups -----------------------------------------------------------

{
  // 単一 group はそのまま1要素の配列に
  const g = { keyword:'x' };
  const groups = toGroups(g);
  assert.equal(groups.length, 1);
  assert.equal(groups[0], g);

  // { groups:[…] }
  const gs = [{ keyword:'a' }, { keyword:'b' }];
  assert.deepEqual(toGroups({ groups: gs }), gs);
  assert.equal(toGroups({ groups: gs })[0], gs[0]);

  // 空配列の groups → 条件なしの1グループ
  assert.deepEqual(toGroups({ groups: [] }), [{}]);

  // null / undefined
  assert.deepEqual(toGroups(null), [{}]);
  assert.deepEqual(toGroups(undefined), [{}]);
}

// --- keywordMatch -----------------------------------------------------------

assert.equal(keywordMatch('週次レビュー', 'レビュー'), true, '部分一致');
assert.equal(keywordMatch('週次レビュー', 'zzz'), false);
assert.equal(keywordMatch('ABC', 'abc'), true, '大文字小文字無視');
assert.equal(keywordMatch('abc', ''), true, '空は条件なし');
assert.equal(keywordMatch('abc', undefined), true, 'undefinedは条件なし');
assert.equal(keywordMatch(null, ''), true, 'content nullでもkw空ならtrue');
assert.equal(keywordMatch(null, undefined), true);
assert.equal(keywordMatch(null, 'abc'), false, 'content nullでも例外を投げず安全にfalse');
assert.equal(keywordMatch(undefined, 'abc'), false);

// --- tagsMatch -----------------------------------------------------------

assert.equal(tagsMatch('x #設計 #実装', ['設計']), true, '単一AND');
assert.equal(tagsMatch('x #設計 #実装', ['設計', '実装']), true, '複数AND');
assert.equal(tagsMatch('x #設計', ['設計', '実装']), false, '一部欠けはfalse');
assert.equal(tagsMatch('x', []), true, '空配列は条件なし');
assert.equal(tagsMatch('x', undefined), true, 'undefinedは条件なし');
assert.equal(tagsMatch(null, []), true, 'content nullでも空条件ならtrue');
assert.equal(tagsMatch(null, ['設計']), false, 'content nullで条件ありならfalse（例外なし）');

// --- projMatch -----------------------------------------------------------

assert.equal(projMatch('p1', 'all'), true);
assert.equal(projMatch('p1', 'p1'), true, '特定ID一致');
assert.equal(projMatch('p1', 'p2'), false, '特定ID不一致');
assert.equal(projMatch(undefined, 'none'), true, 'proj無し×none');
assert.equal(projMatch('p1', 'none'), false, 'proj有り×noneは非該当');
// filter が undefined/'' のときは「すべて」扱いで true（誤判定バグの修正点）
assert.equal(projMatch('p1', undefined), true, 'filter undefinedはall扱い');
assert.equal(projMatch('p1', ''), true, 'filter 空文字はall扱い');
assert.equal(projMatch(undefined, undefined), true);

// --- midMatch -----------------------------------------------------------

assert.equal(midMatch('ABC123', 'abc'), true, '部分一致・大文字小文字無視');
assert.equal(midMatch('ABC123', 'xyz'), false);
assert.equal(midMatch('ABC123', ''), true, '空は条件なし');
assert.equal(midMatch('ABC123', undefined), true);
assert.equal(midMatch(null, ''), true);
assert.equal(midMatch(null, 'abc'), false, 'mid nullでも安全にfalse');

// --- prioMatch -----------------------------------------------------------

assert.equal(prioMatch(3, 'all'), true, 'all は条件なし');
assert.equal(prioMatch(3, undefined), true, 'undefined は条件なし');
assert.equal(prioMatch(3, '3'), true, '数値と文字列の比較');
assert.equal(prioMatch(1, '3'), false);
assert.equal(prioMatch(undefined, '0'), true, 'prio未設定は0扱い');
assert.equal(prioMatch(undefined, '3'), false);
assert.equal(prioMatch(0, '0'), true);

// --- dueGroupMatch (today基準) -----------------------------------------------------------

assert.equal(dueGroupMatch('2026-07-20', { mode:'any' }, today), true, 'anyは常にtrue');
assert.equal(dueGroupMatch(undefined, undefined, today), true, 'cond未指定はanyと同じ');

// none: 期限なしのみtrue
assert.equal(dueGroupMatch('', { mode:'none' }, today), true, '期限なし');
assert.equal(dueGroupMatch(undefined, { mode:'none' }, today), true);
assert.equal(dueGroupMatch('2026-07-05', { mode:'none' }, today), false, '期限ありは非該当');

// range: due が無ければ常にfalse
assert.equal(dueGroupMatch(undefined, { mode:'range', to:-1 }, today), false, 'due無しはrangeでfalse');
assert.equal(dueGroupMatch('', { mode:'range' }, today), false);

// range: 片側だけ（to）
assert.equal(dueGroupMatch('2026-07-01', { mode:'range', to:-1 }, today), true, '期限切れ（toのみ）');
assert.equal(dueGroupMatch('2026-07-01', { mode:'range', to:0 }, today), true, 'toのみ・範囲内');
assert.equal(dueGroupMatch('2026-07-10', { mode:'range', to:0 }, today), false, 'toのみ・範囲外');

// range: 片側だけ（from）
assert.equal(dueGroupMatch('2026-07-01', { mode:'range', from:0 }, today), false, 'fromのみ・範囲外（過去）');
assert.equal(dueGroupMatch('2026-07-10', { mode:'range', from:0 }, today), true, 'fromのみ・範囲内');

// range: 両方（今日、今後7日）
assert.equal(dueGroupMatch('2026-07-05', { mode:'range', from:0, to:0 }, today), true, '今日');
assert.equal(dueGroupMatch('2026-07-06', { mode:'range', from:0, to:0 }, today), false, '今日以外は非該当');
assert.equal(dueGroupMatch('2026-07-10', { mode:'range', from:0, to:7 }, today), true, '今後7日以内');
assert.equal(dueGroupMatch('2026-07-20', { mode:'range', from:0, to:7 }, today), false, '今後7日外');

// --- doneGroupMatch (doneAt基準) -----------------------------------------------------------

assert.equal(doneGroupMatch({ done:false }, { mode:'any' }, today), true);
assert.equal(doneGroupMatch({ done:false }, undefined, today), true, 'cond未指定はanyと同じ');

// notDone
assert.equal(doneGroupMatch({ done:false }, { mode:'notDone' }, today), true);
assert.equal(doneGroupMatch({ done:true }, { mode:'notDone' }, today), false);
assert.equal(doneGroupMatch({}, { mode:'notDone' }, today), true, 'doneを持たないメモはnotDone扱い');

// done: メモ（doneを持たない）はfalse
assert.equal(doneGroupMatch({}, { mode:'done' }, today), false, 'doneを持たないメモはdone指定でfalse');

// done: from/to両方nullなら完了日を問わずtrue（doneAt未記録でもtrue）
assert.equal(doneGroupMatch({ done:true }, { mode:'done' }, today), true, 'range指定なしは完了日を問わない');
assert.equal(doneGroupMatch({ done:true, doneAt:null }, { mode:'done', from:null, to:null }, today), true);

// done: range指定でdoneAt未記録ならfalse
assert.equal(doneGroupMatch({ done:true }, { mode:'done', from:-7, to:0 }, today), false, 'doneAt未記録でrange指定はfalse');

// done: range指定でdoneAtあり
assert.equal(
  doneGroupMatch({ done:true, doneAt:'2026-07-01T10:00:00' }, { mode:'done', from:-7, to:0 }, today),
  true, 'doneAt基準で範囲内'
);
assert.equal(
  doneGroupMatch({ done:true, doneAt:'2026-07-01T10:00:00' }, { mode:'done', from:0, to:0 }, today),
  false, 'doneAt基準で範囲外'
);
// doneAt は UTC の ISO で保存される。JST 00:00〜08:59 の完了を前日と数えない
assert.equal(
  doneGroupMatch({ done:true, doneAt:'2026-07-06T23:00:00.000Z' }, { mode:'done', from:0, to:0 }, '2026-07-07'),
  true, 'JST 7/7 08:00 完了（UTC は 7/6）は「今日完了」'
);
assert.equal(
  doneGroupMatch({ done:true, doneAt:'2026-07-06T14:59:00.000Z' }, { mode:'done', from:0, to:0 }, '2026-07-07'),
  false, 'JST 7/6 23:59 完了は「今日」に含めない'
);

// --- matchGroup（AND） -----------------------------------------------------------

assert.equal(matchGroup(b({ content:'x' }), {}, today), true, '空グループは全件true');
assert.equal(matchGroup(b({}), undefined, today), true, 'group未指定も安全');
assert.equal(
  matchGroup(
    b({ content:'見積 #設計', proj:'p1', due:'2026-07-05', prio:2 }),
    { keyword:'見積', tags:['設計'], proj:'p1', due:{ mode:'range', from:0, to:0 }, prio:'2' },
    today
  ),
  true, '複数条件AND成立'
);
assert.equal(
  matchGroup(
    b({ content:'見積 #設計', proj:'p1', due:'2026-07-05', prio:2 }),
    { keyword:'見積', tags:['設計'], proj:'p2', due:{ mode:'range', from:0, to:0 }, prio:'2' },
    today
  ),
  false, '1条件でも不一致ならAND不成立'
);

// --- matchQuery（OR ＋ kinds） -----------------------------------------------------------

{
  const memo = b({ kind:'memo', content:'議事メモ' });
  const task = b({ kind:'task', content:'見積対応' });
  const query = { groups: [{ keyword:'議事' }, { keyword:'見積' }] };

  assert.equal(matchQuery(memo, query, today), true, 'グループ間OR：片方一致');
  assert.equal(matchQuery(task, query, today), true, 'グループ間OR：もう片方一致');
  assert.equal(matchQuery(b({ content:'関係ない' }), query, today), false, '両方不一致');

  // opts.kinds
  assert.equal(matchQuery(memo, query, today, { kinds:['task'] }), false, 'kinds指定でmemoは除外');
  assert.equal(matchQuery(task, query, today, { kinds:['task'] }), true);
  assert.equal(matchQuery(memo, query, today, { kinds:['memo','task'] }), true);
  assert.equal(matchQuery(task, query, today, { kinds:['memo','task'] }), true);
  assert.equal(matchQuery(memo, query, today), true, 'kinds未指定ならkindを問わない');

  // body null
  assert.equal(matchQuery(null, query, today), false, 'bodyがnullならfalse');
  assert.equal(matchQuery(undefined, query, today), false);
}

// --- groupToFlatQuery -----------------------------------------------------------

{
  const g = {
    keyword: 'k', tags: ['a', 'b'], proj: 'p1', mid: 'M1',
    due: { mode:'range', from:0, to:1 },
    done: { mode:'done' },
    prio: '2',
  };
  const { query, dropped } = groupToFlatQuery(g);

  assert.deepEqual(dropped, ['mid'], 'mid指定時はdropped:[\'mid\']');
  assert.equal(query.mid, undefined, 'midは落ちる');
  assert.equal(query.keyword, 'k');
  assert.deepEqual(query.tags, ['a', 'b']);
  assert.notEqual(query.tags, g.tags, 'tagsは元と別配列（コピー）');
  assert.deepEqual(query.due, { mode:'range', from:0, to:1 });
  assert.notEqual(query.due, g.due, 'dueは元と別オブジェクト（コピー）');
  assert.deepEqual(query.done, { mode:'done' });
  assert.notEqual(query.done, g.done, 'doneは元と別オブジェクト（コピー）');

  // コピーであることの確認（変更が伝播しない）
  query.tags.push('c');
  assert.deepEqual(g.tags, ['a', 'b'], '返り値を変更しても元のgroupは変わらない');
  query.due.from = 99;
  assert.equal(g.due.from, 0);
}

// mid未設定なら dropped:[]
{
  const { dropped } = groupToFlatQuery({});
  assert.deepEqual(dropped, []);
}
{
  const { query, dropped } = groupToFlatQuery(undefined);
  assert.deepEqual(dropped, []);
  assert.equal(query.keyword, '');
  assert.deepEqual(query.tags, []);
  assert.equal(query.proj, 'all');
  assert.deepEqual(query.due, { mode:'any' });
  assert.deepEqual(query.done, { mode:'any' });
  assert.equal(query.prio, 'all');
}

// --- flatQueryToGroup -----------------------------------------------------------

{
  const g = flatQueryToGroup({ keyword:'x' });
  assert.equal(g.keyword, 'x');
  assert.equal(g.mid, '', 'flatQueryにmidという概念はなく常に空');
  // defaultGroupで補完されること
  assert.deepEqual(g.tags, []);
  assert.equal(g.proj, 'all');
  assert.deepEqual(g.due, { mode:'any', from:null, to:null });
  assert.deepEqual(g.done, { mode:'any', from:null, to:null });
  assert.equal(g.prio, 'all');
}
{
  const g = flatQueryToGroup(undefined);
  assert.deepEqual(g, { ...defaultGroup(), mid:'' });
}

// groupToFlatQuery → flatQueryToGroup の往復（mid以外が保たれる）
{
  const g = {
    keyword: 'k', tags: ['a', 'b'], proj: 'p1', mid: 'M1',
    due: { mode:'range', from:0, to:1 },
    done: { mode:'done' },
    prio: '2',
  };
  const { query } = groupToFlatQuery(g);
  const g2 = flatQueryToGroup(query);

  assert.equal(g2.mid, '', 'mid は往復で失われる');
  assert.equal(g2.keyword, g.keyword);
  assert.deepEqual(g2.tags, g.tags);
  assert.equal(g2.proj, g.proj);
  assert.deepEqual(g2.due, g.due);
  assert.deepEqual(g2.done, g.done);
  assert.equal(g2.prio, g.prio);
}

console.log('PASS query');
