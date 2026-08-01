"""server.Api の振る舞い。HTTP を挟まず直接呼んで確かめる。"""

from datetime import datetime

import pytest
from PIL import Image

import server
import storage


@pytest.fixture
def api(tmp_path):
    root = tmp_path / "Shots"
    day = storage.day_dir(root, datetime(2026, 8, 1, 14, 30, 52))
    img = Image.new("RGB", (1920, 1080), (30, 60, 90))
    img.paste((255, 0, 0), (0, 0, 40, 40))  # 左上の目印
    img.save(day / "001_143052.png")
    storage.add_entry(day, "001_143052.png", datetime(2026, 8, 1, 14, 30, 52), 1920, 1080)
    return server.Api(root, {"group_gap_minutes": 30, "png_compress_level": 1})


NAME = "001_143052.png"
DATE = "2026-08-01"


def size_of(api):
    return next(s for s in api.shots(DATE)["shots"] if s["name"] == NAME)


def test_一覧に撮影時刻とサイズが並ぶ(api):
    s = size_of(api)
    assert (s["no"], s["time"], s["w"], s["h"]) == (1, "14:30:52", 1920, 1080)
    assert s["gap"] is True  # 1枚目は必ず区切りの先頭


def test_トリミングは上書きされ一覧のサイズも変わる(api):
    assert api.edit(DATE, NAME, "crop", {"rect": [100, 50, 800, 600]}) == {"w": 800, "h": 600}
    assert (size_of(api)["w"], size_of(api)["h"]) == (800, 600)


def test_回転で縦横が入れ替わる(api):
    assert api.edit(DATE, NAME, "rotate", {"degrees": 90}) == {"w": 1080, "h": 1920}
    assert (size_of(api)["w"], size_of(api)["h"]) == (1080, 1920)


def test_元に戻すと画像が完全に復元する(api):
    before = (api.root / DATE / NAME).read_bytes()
    api.edit(DATE, NAME, "crop", {"rect": [10, 10, 100, 100]})
    assert (api.root / DATE / NAME).read_bytes() != before

    api.undo()
    assert (api.root / DATE / NAME).read_bytes() == before
    assert (size_of(api)["w"], size_of(api)["h"]) == (1920, 1080)


def test_元に戻すのは新しい順(api):
    api.edit(DATE, NAME, "crop", {"rect": [0, 0, 1000, 1000]})
    api.edit(DATE, NAME, "crop", {"rect": [0, 0, 500, 500]})
    assert size_of(api)["w"] == 500

    api.undo()
    assert size_of(api)["w"] == 1000
    api.undo()
    assert size_of(api)["w"] == 1920


def test_保持数を超えた編集は戻せない(api):
    for i in range(server.UNDO_DEPTH + 2):
        api.edit(DATE, NAME, "crop", {"rect": [0, 0, 1900 - i * 10, 1000]})

    for _ in range(server.UNDO_DEPTH):
        api.undo()
    with pytest.raises(server.BadRequest):
        api.undo()


def test_戻す編集が無ければエラー(api):
    with pytest.raises(server.BadRequest):
        api.undo()


def test_未対応の操作は拒否する(api):
    with pytest.raises(server.BadRequest):
        api.edit(DATE, NAME, "blur", {})


def test_rectの形が違えば拒否する(api):
    with pytest.raises(server.BadRequest):
        api.edit(DATE, NAME, "crop", {"rect": "全部"})


def test_メモを保存して一覧に載る(api):
    api.note(DATE, NAME, "請求画面のエラー")
    assert size_of(api)["note"] == "請求画面のエラー"


def test_削除するとゴミ箱へ移り一覧から消える(api):
    api.delete(DATE, NAME)
    assert api.shots(DATE)["shots"] == []
    assert (api.root / storage.TRASH_DIRNAME / f"{DATE}__{NAME}").exists()


@pytest.mark.parametrize(
    "date,name",
    [
        ("../..", NAME),
        (DATE, "../../config.json"),
        (DATE, "001_143052.png.part"),
        ("2026-8-1", NAME),
        ("", ""),
    ],
)
def test_不正なパスは弾く(api, date, name):
    with pytest.raises(server.NotFound):
        api.resolve(date, name)


def test_存在しない画像は404扱い(api):
    with pytest.raises(server.NotFound):
        api.resolve(DATE, "999_000000.png")


def test_間があいたところに区切りが入る(api):
    day = api.root / DATE
    for name, t in (("002_143100.png", "14:31:00"), ("003_160000.png", "16:00:00")):
        Image.new("RGB", (10, 10)).save(day / name)
        storage.add_entry(
            day, name, datetime.fromisoformat(f"2026-08-01T{t}"), 10, 10
        )
    gaps = [s["gap"] for s in api.shots(DATE)["shots"]]
    assert gaps == [True, False, True]  # 30分以上あいた3枚目で区切る


def test_index_が無くてもファイル名から時刻を復元する(api):
    (api.root / DATE / storage.INDEX_NAME).unlink()
    s = size_of(api)
    assert s["time"] == "14:30:52"
    assert s["note"] == ""
