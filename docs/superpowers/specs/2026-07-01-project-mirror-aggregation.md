# プロジェクトの割当カード集約（ミラー）

- 日付: 2026-07-01
- 対象: Tracker v2（`v2/`）。`project.js`（集約セクション）、`daily.js`（renderChildren 拡張＋編集境界）、`app.js`（jump 配線）、`style.css`。
- 由来: ユーザー依頼「各プロジェクトについて、そのPJタグが付いたタスク/ノードのミラーを列挙したい」。

## 確定方針（ユーザー選択）

- **置き場所**: プロジェクトのノートページ下部に「📌 割当カード」セクション。
- **粒度**: 子ごとフルミラー（カード＋子ツリーを編集可能描画）。
- **グループ**: 出所の日付（新しい日が上）。
- **編集境界（重要）**: 各ミラーカードは「タイトル以下だけ」編集可能。
  - **タイトル行（ミラーのルート）で Tab / Shift+Tab / Alt+Shift+↑↓ を押しても元の構造を変えない**（誤操作防止）。タイトル本文の編集は可。
  - **ルート直下の子は Shift+Tab（アウトデント）でルートと同階層へ出られない**（サブツリーから脱出させない）。それより深い子は通常どおり（ルート直下まで）。

## 仕様

### 対象データ（仮想集約・ref は作らない）

- `store.queryBodies(b => b.proj === projId)`（task/memo 両方）。
- 除外:
  1. そのPJのノートページ subtree 内に在るカード（上の手書きノートで表示済み）。
  2. 祖先 ref の body にも同じ `proj` を持つカード（＝別の対象カードの子孫）。＝**最上位の対象カードだけ**拾い、子はそのミラー内で表示。
- グループキー = 出所の日付（祖先を辿って `kind:'day'` の `content`）。day 祖先が無い場合は「その他」。新しい日付順。

### 描画

- `renderPage`（project.js）の手書きアウトライン描画の後に「📌 割当カード」セクションを追加。
- 日付ごとに小見出し → その下に各ルートカードを `renderChildren` でフルミラー描画（ルート＋子ツリー・実体 ref＝編集は全ビューに反映）。
- 各ルート行に `data-mirror-root="1"` を付与し、行に **↗（元の場所＝デイリーへジャンプ）** を添える。
- 空なら案内文。仮想集約＝毎描画で再計算・構造編集で `requestRender`→ライブ更新。

### renderChildren 拡張（daily.js）

- 第6引数 `opts` を追加（既定動作は不変）:
  - `opts.refs`: この呼び出しで描画する ref 配列を明示（既定は `store.childRefs(parentRefId)`）。
  - `opts.mirrorRoot`: true のとき、この呼び出しで作る各行に `dataset.mirrorRoot='1'` を付与（再帰の子呼び出しには渡さない＝子は通常行）。
- `export` して project.js から使用。

### 編集境界（daily.js `onKey` の Tab/move）

DOM マーカーで局所判定（グローバル状態を持たず、ミラーセクションの行だけに効く）:
- Tab：フォーカス行が `[data-mirror-root]` なら **e.preventDefault()して何もしない**（インデント/アウトデントしない）。
- Shift+Tab：フォーカス行の実親 ref が `_ctx.container` 内で `.card-row[data-ref="<親>"][data-mirror-root]` なら **アウトデントしない**（ルートと同階層へ出さない）。
- Alt+Shift+↑↓（移動）：フォーカス行が `[data-mirror-root]` なら **移動しない**（見えていない実兄弟を動かさない）。
- いずれも非ミラー（daily 等）では `data-mirror-root` が無いので従来どおり。

### ジャンプ（↗）

- `renderProjectView(store, mount, requestRender, projState, onJump)` に `onJump` を追加。`app.js` で `jumpToCard`（デイリーで該当カードへ）を渡す。↗ クリックで元ノードへ。

## テスト

- 単体（pure）: 対象収集＋重複除外＋日付グルーピング（`project.js` から純関数を分離 or store ヘルパ）。
- ブラウザ eval: ミラー表示・タイトル編集が全ビュー反映・タイトル行 Tab で構造不変・ルート直下の子が Shift+Tab で脱出しない・深い子は通常 outdent・↗ で元へ。

## 非対象

- 永続ミラー ref（transclusion）。複数 ref のうちどれをミラーするか（先頭 ref 固定）。別PJページに置かれた対象カードの特殊処理（その他グループ扱い）。
