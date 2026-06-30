# 貼り付け時のリンク/太字/色を保存（カード単位）

- 日付: 2026-06-30
- 対象: Tracker v2（`v2/`）
- スコープ: **カード単位**の書式保存（リンク/太字/色）。文字単位（範囲選択）の修飾は将来課題で、本対応はそれを妨げない。

## 背景・原因

v2 はカード本文を**プレーンテキスト**（`content`、`⟦id⟧` メンションマーカー含む）＋**カード単位の属性**（`bold`/`color`/`url`、v0.30.0）で保持する。
リンクなどを含む1行を貼り付けると、現状はブラウザ標準の貼り付けに委譲され（`clipboard.js` の単一行分岐は `preventDefault` せず `return`）、リッチHTMLが一瞬挿入される。だが card-txt の `input` リスナが `serializeEditable`（＝プレーンテキスト）だけを `content` に保存するため、**次の再描画（`fillEditable`）で書式が消える**。

元の Tracker(v1) は `node.text` と `node.html` の両方を保持し、`html` を描画していたためインライン書式が残っていた。v2 は意図的にプレーン＋属性へ移行済み。

## 方針

1行（構造なし）の貼り付けを `clipboard.js` の paste ハンドラで横取りし、クリップボードから**カード全体に効く書式**を検出してカード属性へ保存する。

- 検出があれば: `preventDefault` → カーソル位置にプレーンテキストを挿入（選択範囲があれば置換）→ 検出した `url`/`bold`/`color` を body にマージ → 再描画 → caret 復元。
- 検出が無ければ: 従来どおり標準のプレーン貼り付け。

属性は既存の描画・永続化経路（`cd-bold`/inline color/`cd-link`＋🔗）にそのまま乗るため、消えなくなる。

### 検出ルール（`detectInlineFormat(html, plain)`、保守的）

- **url**: 貼付HTML内の最初の `http(s)` な `<a href>`。無ければ `plain` が単一の裸URL（`^https?://\S+$`）ならそれ。
- **bold**: 貼付テキストの**全テキストノード**が太字（祖先に `<b>/<strong>`、または `font-weight` が `bold`/`bolder`/≥600）のときのみ `true`。
- **color**: 全テキストノードが**単一の明示色**を共有し、それが黒/既定（`#000`,`#000000`,`black`,`rgb(0,0,0)`,`inherit`,`currentcolor`）でないときのみ、その色文字列を採用。
- 表示テキストは HTML があれば `body.textContent` を優先（`<a>表示文字</a>` に対応）、無ければ `plain`。

誤適用回避: 普通の文章（全体太字でない/色が黒既定）は素通り＝プレーン貼り付け。

## 割り切り（今回）

カード属性は**カード全体**に効く。行の途中だけリンク/太字/色にはできない（＝将来の文字単位対応で扱う）。空カードへ貼る・1行まるごと貼る一般ケースは意図通り。

## 変更点

- `v2/src/daily.js`: `serializeEditable` / `caretOffset` を `export`（描画コアは不変）。
- `v2/src/clipboard.js`:
  - `detectInlineFormat(html, plain)`（export・純粋関数。HTML解析は `DOMParser`、裸URL分岐は DOM 不要）＋内部 `analyzeFormatting(root)`。
  - paste ハンドラの単一行分岐で検出→属性保存＋テキスト挿入。挿入は `opts.serializeEditable`/`opts.caretOffset` を使用（選択は `deleteFromDocument` で置換後にスプライス）。
- `v2/src/app.js`: `serializeEditable`/`caretOffset` を `daily.js` から import し `installClipboard(..., { uploadImage, serializeEditable, caretOffset })` で渡す。

## テスト

- 単体（node, `clipboard.test.mjs` に追記）: `detectInlineFormat('', 'https://example.com')` が `url` を返す／普通のプレーンは何も返さない（DOM 非依存の分岐）。
- ブラウザ eval: リンクHTML貼付→`url`保存＋🔗描画＋再描画後も残存／全体太字HTML→`bold`／単一色HTML→`color`／黒や非太字の普通文→素通り。

## 非対象

- 文字単位（範囲選択）の修飾、`html` フィールドの導入、v1 データ移行。これらは将来課題。
