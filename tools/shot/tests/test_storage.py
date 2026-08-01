from datetime import datetime

import pytest

import storage


@pytest.fixture
def root(tmp_path):
    return tmp_path / "Shots"


def test_連番は空フォルダなら001から始まる(root):
    dt = datetime(2026, 8, 1, 14, 30, 52)
    day = storage.day_dir(root, dt)
    assert storage.next_name(day, dt) == "001_143052.png"


def test_連番は既存の最大値の次になる(root):
    dt = datetime(2026, 8, 1, 14, 30, 52)
    day = storage.day_dir(root, dt)
    for n in ("001_100000.png", "007_120000.png", "003_110000.png"):
        (day / n).write_bytes(b"")
    assert storage.next_name(day, dt) == "008_143052.png"


def test_スクショ以外のファイルは連番に影響しない(root):
    dt = datetime(2026, 8, 1, 14, 30, 52)
    day = storage.day_dir(root, dt)
    (day / "005_100000.png").write_bytes(b"")
    (day / "index.json").write_text("{}", encoding="utf-8")
    (day / "メモ.txt").write_text("x", encoding="utf-8")
    (day / "006_100000.png.part").write_bytes(b"")  # 書きかけの一時ファイル
    assert storage.next_name(day, dt) == "006_143052.png"


def test_日付が変わると連番は001に戻る(root):
    d1 = datetime(2026, 8, 1, 23, 59, 0)
    day1 = storage.day_dir(root, d1)
    (day1 / "012_235900.png").write_bytes(b"")

    d2 = datetime(2026, 8, 2, 0, 0, 30)
    day2 = storage.day_dir(root, d2)
    assert day1 != day2
    assert storage.next_name(day2, d2) == "001_000030.png"


def test_index_を書いて読み戻せる(root):
    dt = datetime(2026, 8, 1, 14, 30, 52)
    day = storage.day_dir(root, dt)
    storage.add_entry(day, "001_143052.png", dt, 3840, 2160)

    data = storage.load_index(day)
    entry = data["shots"]["001_143052.png"]
    assert entry["w"] == 3840
    assert entry["h"] == 2160
    assert entry["note"] == ""
    assert entry["ts"].startswith("2026-08-01T14:30:52")


def test_index_書き込み後に一時ファイルが残らない(root):
    dt = datetime(2026, 8, 1, 14, 30, 52)
    day = storage.day_dir(root, dt)
    storage.add_entry(day, "001_143052.png", dt, 100, 100)
    assert not (day / "index.json.tmp").exists()


def test_index_が壊れていても落ちずに空として扱う(root):
    dt = datetime(2026, 8, 1, 14, 30, 52)
    day = storage.day_dir(root, dt)
    (day / "index.json").write_text("{壊れたJSON", encoding="utf-8")

    assert storage.load_index(day) == {"version": 1, "shots": {}}
    # 壊れた状態からでも追記できる
    storage.add_entry(day, "001_143052.png", dt, 10, 10)
    assert "001_143052.png" in storage.load_index(day)["shots"]


def test_index_が想定外の形でも空として扱う(root):
    day = storage.day_dir(root, datetime(2026, 8, 1))
    (day / "index.json").write_text('["リスト"]', encoding="utf-8")
    assert storage.load_index(day)["shots"] == {}


def test_メモを部分更新できる(root):
    dt = datetime(2026, 8, 1, 14, 30, 52)
    day = storage.day_dir(root, dt)
    storage.add_entry(day, "001_143052.png", dt, 100, 200)
    storage.update_entry(day, "001_143052.png", note="請求画面のエラー")

    entry = storage.load_index(day)["shots"]["001_143052.png"]
    assert entry["note"] == "請求画面のエラー"
    assert entry["w"] == 100  # 他の項目は消えない


def test_日付一覧は新しい順で枚数付き(root):
    for date, count in (("2026-07-30", 2), ("2026-08-01", 3)):
        d = root / date
        d.mkdir(parents=True)
        for i in range(1, count + 1):
            (d / f"{i:03d}_120000.png").write_bytes(b"")
    (root / "_trash").mkdir()
    (root / "メモ").mkdir()  # 日付形式でないフォルダは無視する

    assert storage.list_days(root) == [("2026-08-01", 3), ("2026-07-30", 2)]


def test_一覧は連番順で10枚目が2枚目の後に来る(root):
    day = storage.day_dir(root, datetime(2026, 8, 1))
    for i in (1, 2, 10, 3):
        (day / f"{i:03d}_120000.png").write_bytes(b"")
    assert storage.list_shots(day) == [
        "001_120000.png",
        "002_120000.png",
        "003_120000.png",
        "010_120000.png",
    ]


def test_削除はゴミ箱へ移動しindexからも消える(root):
    dt = datetime(2026, 8, 1, 14, 30, 52)
    day = storage.day_dir(root, dt)
    (day / "001_143052.png").write_bytes(b"png")
    storage.add_entry(day, "001_143052.png", dt, 10, 10)

    dst = storage.move_to_trash(root, "2026-08-01", "001_143052.png")

    assert not (day / "001_143052.png").exists()
    assert dst.exists() and dst.read_bytes() == b"png"
    assert storage.load_index(day)["shots"] == {}
