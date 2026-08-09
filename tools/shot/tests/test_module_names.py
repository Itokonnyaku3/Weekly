"""どのモジュールも「定義されていない名前」を参照していないことを確かめる。

ctypes のコールバック（ウィンドウプロシージャ）の中で NameError が起きても、
pythonw では標準エラーがどこにも出ず、その処理だけが黙って失われる。
実際、winapi から MF_CHECKED を import し忘れたせいで、トレイの右クリック
メニューが「押しても何も出ない」状態になった。import 漏れは実行するまで
分からないので、静的に洗い出しておく。

symtable を使うと、その名前がローカル変数なのかモジュール外から来るのかを
Python 自身の判定で区別できる。
"""

import builtins
import importlib
import symtable
from pathlib import Path

import pytest

TOOL_DIR = Path(__file__).resolve().parents[1]

MODULES = [
    "autocrop", "capture", "clipboard", "config", "flash", "imageops",
    "saver", "server", "shot", "startup", "storage", "tray", "viewerwin",
    "winapi",
]


def _referenced_globals(table: symtable.SymbolTable):
    """その表とすべての入れ子で参照されている、モジュール外の名前を挙げる。"""
    for sym in table.get_symbols():
        if sym.is_global() and sym.is_referenced():
            yield sym.get_name()
    for child in table.get_children():
        yield from _referenced_globals(child)


def undefined_names(path: Path, module) -> list[str]:
    table = symtable.symtable(path.read_text(encoding="utf-8"), str(path), "exec")
    return sorted(
        {
            name
            for name in _referenced_globals(table)
            if not hasattr(module, name) and not hasattr(builtins, name)
        }
    )


@pytest.mark.parametrize("name", MODULES)
def test_未定義の名前を参照していない(name):
    module = importlib.import_module(name)
    missing = undefined_names(TOOL_DIR / f"{name}.py", module)
    assert not missing, f"{name}.py が未定義の名前を参照しています: {missing}"


def test_この検査自体が漏れを見つけられる(tmp_path):
    """検査が素通りしていないことを確かめる（import 漏れを模したモジュール）。"""
    src = tmp_path / "leaky.py"
    src.write_text(
        "from math import pi\n"
        "def area(r):\n"
        "    local = r * r\n"
        "    return pi * local * MISSING_CONSTANT\n",
        encoding="utf-8",
    )
    import types

    module = types.ModuleType("leaky")
    module.pi = 3.14

    assert undefined_names(src, module) == ["MISSING_CONSTANT"]
