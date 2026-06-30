# リスト欄の改善: ツリー表示＋詳細ポップアップ（ミラー編集）

- 日付: 2026-06-30
- 対象: Tracker v2（`v2/`）。主に `v2/src/list.js`、新規ポップアップ、`v2/style.css`。
- 由来: ユーザー依頼＋モック2枚（グループ表示のスクショ／ポップアップのスケッチ）。

## 目的

リストを (1) ツリーで俯瞰しやすく、(2) 属性編集はポップアップで安全に、(3) ポップアップでカード内容（タイトル以下）をミラー編集できるようにする。

## 確定した方針（ユーザー選択）

1. **ツリー表示時は PJ/中項目列を隠してツリーに一本化**（他の並べ替えでは従来通り列表示）。
2. 詳細ポップアップの属性は **即反映・閉じるだけ**（OK/Cancel は置かない）。
3. ポップアップは **Alt+Enter ＋ セルクリック**両方で開く。PJ/中項目/優先度/期限の**セル直接編集は廃止し表示専用**に。

## Part 1 — ツリー表示（commit 1）

- `state.sort === 'proj'`（グループ表示）のときのみ:
  - 表示列から `project` と `mid` を除外（`thead` とタスク行の両方）。`groupRow`/`midRow` の `colSpan` は除外後の列数に追従。
  - 階層インデント: PJ見出し=indent0、中項目見出し=indent1、タスク行=（中項目ありPJなら）indent2／（中項目なしPJなら）indent1。インデントはタスク行の先頭セルに `padding-left` で付与。見出し行はテキスト先頭の余白で表現。
- `sort` がそれ以外（期限/優先度/作成日/タイトル）のときは従来どおり全アクティブ列を表示（ツリーなし・区切りなし）。
- 既存のグループ/中項目の折りたたみ（`_collapsedGroups`/`_midCollapsed`）とカスケード（Ctrl+↑↓）はそのまま動く。

## Part 2 — 詳細ポップアップ（commit 2）

- 新規 `openTaskDetail(store, bodyId, listRequestRender)`（`list.js` 内）。モーダル overlay + box を `document.body` に append。
- 上部フィールド: **プロジェクト(select) / 中項目(text + `pwt2-mids` datalist) / 優先度(select) / 期限(date)**。各 `change` で `store.updateBody(bodyId, {...})`（**即反映**）。リスト裏側の再描画は**閉じたときに一括**（`listRequestRender`）。
- 開く導線:
  - タスク行の PJ/中項目/優先度/期限セルの**クリック**（これら4セルは表示専用 span 化。色付き表示は維持。`data-col`/`data-fkey`/`navKey` によるセルカーソルは維持）。
  - 任意のタスク行フォーカス時の **Alt+Enter**（`navKey` で検出し、`tr.dataset.task` から開く）。
  - 完了チェックボックスとタイトルのインライン編集は**従来どおり**残す。
- 閉じる: Esc / × ボタン / 外側（overlay backdrop）クリック → overlay 除去 ＋ `listRequestRender()`。

## Part 3 — ミラー編集（commit 2・ポップアップ下部）

- ポップアップ下部に、そのタスクの**アウトラインをミラー表示**。`fref = store.refsForBody(bodyId)[0]` を root に **共用 `renderOutlinePage` をモーダル内コンテナへ描画**。タイトル（`zoom-title-txt`）＝カード本文、配下＝子カード。実体は同一の body/ref なので**編集は全ビューに反映**（真のミラー）。
- `opts.inheritProj = body.proj`（モーダル内の新規カードもPJ継承）。
- モーダル内ナビ: Enter分割/Tab/↑↓/@メンション等は `_ctx.container`＝モーダルで動作。ズーム:
  - `onZoomIn(rid)`: モーダルの root を rid に（さらに潜る）。
  - `onZoomOut(rid,pos)`: 親へ戻す。ただし**元のタスク root より上には行かず**、元 root で Alt+↑ なら**モーダルを閉じる**。
- `renderOutlinePage` の `requestRender` には**モーダル再描画関数**を渡す（構造変更時にモーダル下部だけ再描画）。属性フィールドの変更はミラーに影響しないため再描画不要。

## `_ctx` の扱い（唯一の注意点）

`renderOutlinePage` はモジュールグローバル `_ctx`（`daily.js`）を更新する。モーダルを開くと `_ctx.container` がモーダルを指す。リスト編集は `_ctx` を使わないため実害なし。閉じてデイリー/プロジェクト/リストへ遷移すれば次の描画で `_ctx` が再設定され復帰する。

## テスト

- 単体（既存 `list.select` 等は不変）。本機能はDOM/モーダル中心のため**ブラウザ eval で検証**:
  - Part1: `sort=proj` で PJ/中項目列が消える・見出しインデント・タスク行インデント・折りたたみ＆カスケード無回帰／他 sort で全列表示。
  - Part2: セルクリック/Alt+Enter で開く・属性変更が即 body に反映・閉じてリスト反映・セルカーソル無回帰。
  - Part3: ミラーのタイトル/子編集が body に反映（デイリーと一致）・Enter分割・Alt+↑で閉じる・inheritProj。

## 非対象

- 文字単位修飾（別件）。複数refのうちどれをミラーするかの選択UI（今回は先頭ref固定）。ポップアップでのドラッグ並べ替え以外の高度操作（既存キー操作で足りる範囲）。
