# Tracker v2 — CHANGELOG

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
