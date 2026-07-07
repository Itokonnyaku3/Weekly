# 設計書: 検索/ライブクエリ機能（Tana/Logseq風）

作成日: 2026-07-05
対象: `v2/`（Tracker v2）

## 目的

デイリー・プロジェクトを横断して**全カード（メモ＋タスク）**を検索する。**キーワード／タグ／プロジェクト／期限（今日基準）／完了／優先度**を **AND** で指定でき、結果は**編集可能ミラー**で表示（実体編集＝全ビューに反映）・**ライブ更新**。検索は**名前付きで保存**でき、専用一覧から呼び出せる。さらにカード本文から**特定の保存検索へリンク**できる。

軽さ最優先：クエリ判定は純関数、結果描画は既存のミラー（`renderChildren`＋`mirrorRoot`）を流用、保存は既存 `views` ストアを流用。

## 進め方

前回同様、**新ブランチ（`feature/search-live-query`）→ フェーズごとに実装 → push → 都度 main にマージ → Pages で確認 → 次**。各フェーズで **APP_VERSION** を上げる。純ロジックは単体テスト、UIは実機eval。

## データモデル（前提・最小追加）

- カード本体 `body`: `kind`(memo/task/day/project/table/image), `content`(本文・`#タグ`や`⟦id⟧`を含む), `proj`, `mid`, `due`, `prio`, `done`/`doneAt`。
- 検索は **memo/task のみ**対象（day/project/table/image は除外）。
- タグは本文中の `#語`（既存のタグ機能・`TAG_RE = /#([^\s#⟦⟧]+)/g`）。
- 保存検索は既存 `store.saveView(obj)` に `kind:'search'` を付けて格納（リストの保存ビューは `kind` 無し＝`list` 扱い、と区別）。**新フィールドは追加しない**。
- 保存検索リンクは本文マーカー `⟦s:<viewId>⟧`（`@`メンションの `⟦id⟧` と同系統・接頭辞 `s:` で識別）。

## クエリ表現

```
query = {
  keyword: '',                 // 本文部分一致（大文字小文字無視）
  tags: [],                    // すべて含む（AND）。各要素はタグ名（#無し）
  proj: 'all',                 // 'all' | 'none' | <projId>
  due:  { mode:'any', from:null, to:null },   // 'any' | 'none' | 'range'(today基準の日数)
  done: { mode:'any' },        // 'any' | 'done' | 'notDone'
  prio: 'all',                 // 'all' | '0'..'3'
}
```

- **今日基準プリセット**（UI）→ query.due に変換: 期限切れ=`range,to:-1` / 今日=`range,from:0,to:0` / 今後7日=`range,from:0,to:7` / 期限なし=`none` / すべて=`any`。範囲直接指定も可（from/to）。
- done は memo（`done`無し）を `notDone` 扱い（`!body.done` が真）。`done` 指定時は memo は非該当。

## Phase 1: クエリ基盤＋検索ビュー

### 純ロジック（`search.js`・テスト対象）
- `cardTags(content)`: `TAG_RE` で本文からタグ名の集合を返す。
- `matchCard(body, query, today)`: 次を **AND** で判定。
  - kind が memo/task 以外は `false`。
  - keyword: 指定時 `(body.content||'').toLowerCase().includes(keyword.toLowerCase())`。
  - tags: 指定時、`cardTags(body.content)` が query.tags を全て含む。
  - proj: `projMatch`（all/none/id）。
  - due: `dueGroupMatch(body.due, query.due, today)`（list.js の実装を共通化 or 同等移植）。
  - done: `query.done.mode==='done'?!!body.done : mode==='notDone'?!body.done : true`。
  - prio: `prio==='all' || String(body.prio||0)===prio`。
- `runQuery(store, query, today)`: 全 body を走査し `matchCard` で絞り、**参照(ref)の最上位だけ**返す（ある一致カードの祖先も一致する場合は祖先だけ＝`collectMirrorRoots` と同じ重複除外）。戻り値は `[{ ref, body }]`。

### ビュー（`search.js` `renderSearchView(store, mount, requestRender, searchState, onJump)`）
- 上部に**クエリビルダ**（1行群）: キーワード入力／タグ入力（複数・`#`補完流用可）／プロジェクト select／期限プリセット select／完了 select／優先度 select。変更で `searchState.query` を更新し `requestRender()`（ライブ）。
- 下部に**結果**: `runQuery` の各ルートを**編集可能ミラー**で列挙（`renderChildren(store, null, box, 0, requestRender, { refs, mirrorRoot:true })`）。各ルート行に ↗（`onJump(bodyId)` → デイリー/PJ の元へ）。
- 件数表示。0件時はヒント。
- `searchState`（app 保有・セッション）に現在の query を保持。
- app 側: ツールバーに「🔍 検索」ボタン＋ビュー切替に `search` を追加（`currentView` に 'search'）。分割は対象外（単独ビュー）。ナビ履歴（Alt+←/→）にも 'search' を含める。

### 検証
- 単体: `matchCard`（各条件AND・kind除外・タグAND・today基準due・done/memo扱い）、`runQuery`（重複除外＝祖先優先）。
- 実機: 各条件で結果が絞れる・ミラー編集が反映・↗ジャンプ・ライブ更新。

## Phase 2: 保存検索の一覧

- 検索ビューに**保存バー**: 名前入力＋「保存」（`store.saveView({ kind:'search', name, query })`）。既存を選ぶ select（`store.listViews().filter(v=>v.kind==='search')`）＝**読込**（query を適用）。上書き（`updateView`）・改名・削除（`deleteView`）。
- 読込後は `searchState.query` を差し替えて再描画。
- 検証: 保存→別条件→読込で復元・上書き・削除。単体は `saveView/updateView/deleteView`（既存テスト範囲）＋実機。

## Phase 3: 保存検索へのリンク

- 本文で `@` を押した時のポップアップに**保存検索も候補**として出す（`kind:'search'` の views）。選択で `⟦s:<viewId>⟧` を挿入。
- `fillEditable` で `⟦s:id⟧` を**検索リンクチップ**として描画（`makeChip` を拡張し `s:` 接頭辞を判定）。クリックで**検索ビューを開きその保存検索を実行**（app のコールバック `openSavedSearch(viewId)`）。
- `serializeEditable`/`caretOffset` は既存の `⟦...⟧` 機構で往復（マーカー長で計算済み）。
- 検証: `@`で保存検索を選ぶ→チップ挿入→クリックで検索ビューに遷移し結果表示・往復。

## 非機能・デグレ回避

- 既存の list の `dueGroupMatch`/`projMatch`/`TAG_RE` はできるだけ共通化（重複移植する場合は挙動一致をテストで担保）。
- 全カード走査は O(カード数)／描画のたび。データ規模では問題ないが、`runQuery` は1回の走査に留める。
- ミラーは実体編集（表示の絞り込みのみ）。検索条件に合わなくなった編集をしても、その場では消えない（次の再描画で反映）＝ライブの自然な挙動。
- 各フェーズ独立コミット＋版数UP＋mainマージ＋実機確認。

## 要確認・割り切り

- タグ入力UIは「スペース/カンマ区切りで複数」または個別チップ追加。まずは**スペース/カンマ区切りの1入力**（軽量）とする。
- 結果の並び順は Phase 1 では出所日付→プロジェクトの安定順（詳細は実装時）。並べ替えUIは今回スコープ外。
- OR条件は今回対象外（AND単一グループ）。必要なら後日 list 同様のグループORを検討。
