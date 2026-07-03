# 設計書: リスト/デイリー UX 改善バッチ2（7件）

作成日: 2026-07-03
対象: `v2/`（Tracker v2）

## 背景・進め方

日々の運用で挙がったUX改善7件。**1つずつ実装→push→mainにマージ→公開サイト(Pages)で確認→次へ**の順で進める。
デグレ回避のため既存関数への局所的変更に留め、純ロジックには単体テスト、UIは実機evalで確認する。

- ブランチ運用: main から新ブランチを切り、各タスクを commit→push 後に **GitHub `/merges` API で main にマージ**（都度公開反映）。
- 実装順は下表の #1→#7（おおむね独立）。

## タスク一覧と確定仕様

### #1 折りたたみ中の中項目に件数バッジ
- 中項目見出し(`midRow`, list.js:161)が**折りたたみ(▸)のとき**、配下タスク件数を見出しに表示（例: `▸ 設計 (3)`）。展開時(▾)は非表示。
- 件数＝その (proj, mid) グループに属する表示対象タスク数（描画ループで既に `counts`/グループ化しているので、mid単位の件数を数えて `midRow` に渡す）。
- 変更: `renderList` の描画ループで mid ごとの件数を集計し `midRow(..., count)` へ。`midRow` は折りたたみ時のみ `(n)` を名前の後に付す。

### #2 中項目でCtrl+↑は配下優先で段階的に畳む
- 現状 `collapseKey`（list.js:856）で mid 見出しの Ctrl+↑ は即 `projColl[proj]=true`（PJ全体を畳む）。
- 変更: **mid が未折りたたみなら、まず mid の配下を畳む**（`midSetColl(midColl, proj, mid, true)`→`focusHeader(proj, mid)`）。**既に mid が折りたたみ済みなら**従来どおり PJ 全体を畳む（`projColl[proj]=true`→`focusHeader(proj)`）。PJ見出しの段階的挙動と揃える。
- Ctrl+↓（展開）側は現状維持（対象外）。

### #3 Alt+1 でリスト本体を選択
- 現状 `selectView('list')`→`restoreFocus('list')`。記憶フォーカスが無いとブラウザ既定で先頭タブ可能要素＝ビュー選択欄にフォーカスが行く。
- 変更: `restoreFocus('list')` で記憶が無い場合、**リスト本体の先頭（最初のタスク行のセル、無ければ最初の `nav-head`）にフォーカス**する。ビュー選択欄には行かない。
- 実装は app.js の `restoreFocus`（list分岐）にフォールバックを追加。DOMは `.list-table` 内の最初の `[data-fkey]`/`.nav-head`。

### #4 リストからビュー選択欄へのショートカット
- リスト表示中に **Alt+V** で、保存ビューの選択欄（`buildViewBar` の `<select>`、`(現在の条件)`）へフォーカス。
- そのセレクトで**ビューを選択（change）したら、フォーカスをリスト本体へ戻す**（#3 と同じ復帰先）。
- 実装: app.js の Alt キーハンドラに `KeyV`（list ビュー時のみ）を追加してセレクトへ `.focus()`。ビューセレクトの `change` ハンドラ末尾でリストへフォーカス復帰。キーは Alt+V（衝突なし）。

### #5 タイトル列の幅を固定（文字列で広がらない）
- タイトルが長いと列が横に伸びる。**タイトルのチップを1行省略表示**にして列を広げない。
- 変更: `style.css` の `.c-title`（またはタイトルチップ）に `max-width`＋`white-space:nowrap; overflow:hidden; text-overflow:ellipsis`。全文はチップの `title` 属性（ホバー）＋ダブルクリック/詳細で確認可。編集時(`.list-title`)は従来どおり。
- ツリー表示のインデント（`paddingLeft`）と両立させる。

### #6 リンクを Ctrl/⌘+クリックで開く
- url 付きカード（daily.js:191 で `.cd-link` 付与）本文を **Ctrl/⌘+クリックで `window.open`**。通常クリックは従来どおり編集カーソル。既存の 🔗 ボタン・Shift+Enter は維持。
- 実装: `daily.js` の本文要素（`.cd-link` のとき）に `click` リスナ。`if ((e.ctrlKey||e.metaKey) && body.url){ e.preventDefault(); window.open(body.url,'_blank','noopener'); }`。

### #7 ビュー条件バー全体の折り畳み
- `buildControls`（list.js:547）が返す条件バー全体（フィルタ条件グループ＋並べ替え＋列選択＋件数）を**折りたたみトグル**で開閉。既定は開。開閉状態は `state._condOpen` に保存（`_colOpen` と同様セッション/永続）。
- 保存ビューのバー（`buildViewBar`）は常時表示（折り畳み対象外）。
- 実装: `buildControls` の内容を `<details open>`（または独自トグル＋クラス）で包み、`state._condOpen` と連動。折りたたみ時はサマリだけ表示（例: 「条件 ▾ / ▸」＋現在の件数）。

## 非機能・デグレ回避

- 既存の描画・永続・キーボード操作・undo/redo 経路を壊さない（すべて既存API・state経由）。
- #1/#2 は純ロジック（件数集計・段階判定）を可能な範囲で関数化し単体テスト。#3〜#7 は実機evalで確認。
- 各タスク後に全単体テスト（現状20件）が緑であることを確認。

## テスト方針（タスク別）

- #1: mid件数の集計ヘルパを単体テスト（(proj,mid)ごとの件数）。
- #2: `collapseKey` の mid 段階判定を関数化して単体テスト（未折り→mid畳み／折り済み→PJ畳み）。難しければ実機eval。
- #3/#4/#5/#6/#7: 実機eval（フォーカス先・ショートカット・列幅・Ctrl+クリック開く・条件バー開閉）。
