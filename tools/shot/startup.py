"""スタートアップ登録の ON/OFF。

ショートカット(.lnk)の作成には COM が要るので、同梱の install_startup.ps1 に任せる。
Python 側は「今どちらか」を判定して呼び分けるだけ。
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
PS1 = HERE / "install_startup.ps1"
LNK_NAME = "shot.lnk"


def startup_dir() -> Path:
    return (
        Path(os.environ["APPDATA"])
        / "Microsoft"
        / "Windows"
        / "Start Menu"
        / "Programs"
        / "Startup"
    )


def is_enabled() -> bool:
    return (startup_dir() / LNK_NAME).exists()


def _run(*args: str) -> bool:
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
             "-File", str(PS1), *args],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return r.returncode == 0
    except OSError:
        return False


def enable() -> bool:
    return _run()


def disable() -> bool:
    return _run("-Remove")


def toggle() -> bool:
    """切り替えた結果の状態を返す。"""
    if is_enabled():
        disable()
    else:
        enable()
    return is_enabled()
