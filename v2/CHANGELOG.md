# Tracker v2 — CHANGELOG

## v0.2.0 — 編集できるデイリーノート（2026-06-17）

最小アウトライナーとして編集可能に。新モデル上にクリーン実装（現行の旧モデル依存処理は移植しない方針）。

- **編集**: 各カードは contenteditable。入力はその場で本体へ保存（再描画せず caret 保持）。
- **キー操作**（挙動は現行アプリ寄り）: Enter＝カーソル位置で分割し新カード／Tab・Shift+Tab＝インデント・アウトデント／Backspace（行頭）＝前カードへ結合（子は引き継ぎ）／↑↓＝カード間移動。
- **IME安全**: 変換確定前（`isComposing`／keyCode 229）はキー処理を素通りし、誤分割を防止。
- **描画分離**: テキスト入力では再描画せず、構造が変わる操作だけ明示再描画＋caret復元（`focusRef`）。旧アプリの「再描画でフォーカスが飛ぶ」問題を構造的に回避。
- ストアに構造ヘルパ追加（`prevSiblingRef`／`orderAfter`＝分数order／`endOrder`）＋単体テスト `store.struct`。
- 検証: 単体テスト6本緑＋ブラウザで Enter／Tab／Shift+Tab／↑↓／IMEガード／Backspace結合をイベント発火で確認。

## v0.1.1 — 最小デイリー描画＋開発キャッシュ対策（2026-06-17）

フェーズ2の最初のスライス。エンジンの中身が画面に見えるようになった。

- **最小デイリービュー**（`src/daily.js`）: 日カード見出し＋配下の付箋ツリーを再帰描画。タスクはチェックボックス（完了で打ち消し線）、メモは「•」。カードが無ければ案内文。
- `app.js`: 「変更購読 → 保存＋再描画」を一本化。`#view-daily` に描画。
- **開発時のESモジュールキャッシュ対策**: エントリを `index.html` の動的 import に変え `?v=Date.now()` を付与、`app.js` が `import.meta.url` の `?v=` を兄弟モジュールへ伝播。これで毎回新鮮に読み込まれ、編集→普通のリロードで反映される（ハードリロード不要）。
- まだ読み取り中心。編集／Enter分割／キーボード／IME はこの後の設計で載せる。

## v0.1.0 — 土台（2026-06-17）

新タスクツールの全面作り直し（本体＋付箋カードモデル）フェーズ1。現行アプリとは完全分離（`v2/` 配下・localStorage キー `pwt2_data`）。

- **データモデル**（`src/store.js` / `createStore` ファクトリ）
  - 本体（body）＝中身＋固有属性、付箋（ref）＝画面に出る配置でツリーを保持
  - `createCard`（本体＋最初の付箋を原子的生成）／`getBody`・`getRef`・`updateBody`・`updateRef`
  - `childRefs`（順序付きツリー）／`refsForBody`／`deleteRef`（子の連鎖削除＋参照ゼロで本体GC）
  - `queryBodies`（リストビュー用レンズ）／`ensureDayCard`（日カードの確保・重複生成なし）
- **永続化**（`src/persist.js`）: localStorage へデバウンス保存／起動時に復元
- **外枠**: `index.html`・`style.css`・`src/app.js`（ESモジュール、`package.json` `type:module`）
- **検証**: 単体テスト5本（`tests/*.mjs`）すべて緑。ブラウザで「作成→保存→再読込で復元」を確認（`seq` 引き継ぎ含む）。
