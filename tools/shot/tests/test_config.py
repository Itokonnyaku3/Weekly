import json

import pytest

import config


@pytest.fixture
def cfg_path(tmp_path, monkeypatch):
    path = tmp_path / "config.json"
    monkeypatch.setattr(config, "CONFIG_PATH", path)
    return path


def test_設定ファイルが無ければ既定値で作る(cfg_path):
    cfg = config.load()
    assert cfg == config.DEFAULTS
    assert json.loads(cfg_path.read_text(encoding="utf-8")) == config.DEFAULTS


def test_書いた値が優先される(cfg_path):
    cfg_path.write_text(json.dumps({"hotkey": "PrintScreen"}), encoding="utf-8")
    cfg = config.load()
    assert cfg["hotkey"] == "PrintScreen"
    assert cfg["port"] == config.DEFAULTS["port"]  # 書いていない項目は既定値


def test_BOM付きで保存されていても読める(cfg_path):
    # メモ帳や PowerShell の Set-Content -Encoding utf8 は BOM を付ける。
    # ただの utf-8 として読むと解析に失敗し、設定が丸ごと無視されてしまう。
    cfg_path.write_text(json.dumps({"flash_ms": 1500}), encoding="utf-8-sig")
    assert config.load()["flash_ms"] == 1500


def test_設定項目が増えたら書き戻す(cfg_path):
    cfg_path.write_text(json.dumps({"hotkey": "Ctrl+Alt+S"}), encoding="utf-8")
    config.load()

    saved = json.loads(cfg_path.read_text(encoding="utf-8"))
    assert set(saved) == set(config.DEFAULTS)
    assert saved["hotkey"] == "Ctrl+Alt+S"  # 書いてあった値は保つ


def test_壊れていても既定値で起動する(cfg_path):
    cfg_path.write_text("{壊れたJSON", encoding="utf-8")
    assert config.load() == config.DEFAULTS


def test_想定外の形でも既定値で起動する(cfg_path):
    cfg_path.write_text('["リスト"]', encoding="utf-8")
    assert config.load() == config.DEFAULTS


def test_保存先は空なら既定の場所になる():
    from pathlib import Path

    assert config.root_dir({"root": ""}) == Path.home() / "Pictures" / "Shots"


def test_保存先に環境変数を書ける(monkeypatch):
    from pathlib import Path

    monkeypatch.setenv("SHOT_TEST_DIR", r"D:\Shots")
    assert config.root_dir({"root": "%SHOT_TEST_DIR%"}) == Path(r"D:\Shots")
