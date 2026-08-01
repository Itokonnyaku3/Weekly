import numpy as np
import pytest
from PIL import Image, ImageDraw

import autocrop


def desktop(size=(1920, 1080), bg=(60, 62, 70)):
    return Image.new("RGB", size, bg)


def put_document(img, box, *, lines=14, bg=(255, 255, 255)):
    """box=(x, y, w, h) の位置に、文字の並んだ白いページを置く。"""
    x, y, w, h = box
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=bg)
    for i in range(lines):
        ly = y + int(h * (i + 1) / (lines + 2))
        d.line([x + w * 0.08, ly, x + w * 0.92, ly], fill=(40, 40, 40), width=max(2, h // 120))
    return img


def test_16対9のスライドを見つける():
    img = put_document(desktop(), (300, 150, 1280, 720))
    found = autocrop.detect(img)

    assert found is not None
    x, y, w, h = found["rect"]
    assert abs(x - 300) <= 8 and abs(y - 150) <= 8
    assert abs(w - 1280) <= 12 and abs(h - 720) <= 12
    assert found["kind"] == "16:9 スライド"
    assert found["confidence"] > 0.6


def test_A4縦のページを見つける():
    img = put_document(desktop(), (620, 40, 680, 962), lines=24)
    found = autocrop.detect(img)

    assert found is not None
    assert found["kind"] == "A4 縦"


def test_4対3のスライドを見つける():
    img = put_document(desktop(), (400, 120, 1000, 750))
    assert autocrop.detect(img)["kind"] == "4:3 スライド"


def test_大きな図を貼ったスライドでも見つける():
    # スライドの下半分に写真。左右に余白が残っていれば紙は一続きなので追える。
    img = put_document(desktop(), (320, 150, 1280, 720), lines=4)
    x, y, w, h = 320, 150, 1280, 720
    ImageDraw.Draw(img).rectangle(
        [x + w * 0.05, y + h * 0.55, x + w * 0.95, y + h * 0.92], fill=(45, 60, 90)
    )
    found = autocrop.detect(img)

    assert found is not None
    assert found["kind"] == "16:9 スライド"
    assert max(abs(a - b) for a, b in zip(found["rect"], [x, y, w, h])) <= 12


def test_余白なく全面に画像を敷いたスライドは見送る():
    # 左右の余白まで画像で埋まると、明るさからは紙の範囲が分からない。
    # 誤った位置を提案するくらいなら何も出さないほうがよい。
    img = put_document(desktop(), (320, 150, 1280, 720), lines=3)
    ImageDraw.Draw(img).rectangle([320, 150 + 360, 320 + 1280, 150 + 720], fill=(45, 60, 90))
    assert autocrop.detect(img) is None


def test_既知の書式でない縦横比は提案しない():
    # 明るくて中身もあるが 2.8:1。スライドでもページでもないので見送る
    assert autocrop.detect(put_document(desktop(), (200, 100, 1400, 500))) is None


def test_デスクトップ全体を拾わない():
    # タスクバーだけ暗い、ふつうのデスクトップの撮影。
    # 「明るくて大きい矩形」ではあるが、切っても意味がないので提案してはいけない。
    img = put_document(desktop(), (0, 0, 1920, 1032), lines=30)
    assert autocrop.detect(img) is None


# --- 提案してはいけない場合 ------------------------------------------------


def test_真っ白な画面では提案しない():
    assert autocrop.detect(Image.new("RGB", (1920, 1080), (255, 255, 255))) is None


def test_中身のない白い矩形は提案しない():
    img = desktop()
    ImageDraw.Draw(img).rectangle([300, 150, 1580, 870], fill=(255, 255, 255))
    assert autocrop.detect(img) is None


def test_真っ暗な画面では提案しない():
    assert autocrop.detect(Image.new("RGB", (1920, 1080), (10, 10, 10))) is None


def test_小さすぎる領域は提案しない():
    # 画面の 5% ほどしかない付箋のような白い矩形
    img = put_document(desktop(), (100, 100, 320, 180), lines=5)
    assert autocrop.detect(img) is None


def test_画面いっぱいなら切る意味がないので提案しない():
    img = put_document(desktop(), (0, 0, 1920, 1080), lines=30)
    assert autocrop.detect(img) is None


def test_写真のようにばらついた画面では提案しない():
    rng = np.random.default_rng(20260801)
    noise = rng.integers(0, 256, size=(1080, 1920, 3), dtype=np.uint8)
    assert autocrop.detect(Image.fromarray(noise)) is None


def test_極端に細い画像でも落ちない():
    assert autocrop.detect(Image.new("RGB", (1, 400), (255, 255, 255))) is None


# --- 補助関数 --------------------------------------------------------------


@pytest.mark.parametrize(
    "profile,expected",
    [
        # 途中が落ち込んでいても両端を取る（紙の中の写真や見出しで切れないため）
        ([0.0, 0.9, 0.1, 0.0, 0.9, 0.0], (1, 5)),
        ([0.9, 0.9, 0.9], (0, 3)),
        ([0.0, 0.0, 0.0], None),
        # しきい値ちょうどは内側とみなす
        ([0.0, 0.3, 0.0], (1, 2)),
    ],
)
def test_端の位置を取り出す(profile, expected):
    assert autocrop._extent(np.array(profile)) == expected


def test_最大の連結成分の外接矩形を返す():
    grid = np.zeros((10, 10), dtype=bool)
    grid[1:3, 1:3] = True          # 小さい塊
    grid[4:9, 3:8] = True          # 大きい塊
    assert autocrop._largest_component(grid) == (3, 4, 8, 9)


def test_連結成分は斜めではつながらない():
    grid = np.zeros((6, 6), dtype=bool)
    grid[0:2, 0:2] = True
    grid[2:4, 2:4] = True          # 角で接するだけ
    x0, y0, x1, y1 = autocrop._largest_component(grid)
    assert (x1 - x0, y1 - y0) == (2, 2)


def test_明るい画素が無ければ連結成分も無い():
    assert autocrop._largest_component(np.zeros((5, 5), dtype=bool)) is None


def test_縮小しても座標は元のスケールで返る():
    # 4K 相当。内部では 1000px に縮めて解析するが、返る座標は原寸。
    img = put_document(desktop((3840, 2160)), (600, 300, 2560, 1440), lines=20)
    x, y, w, h = autocrop.detect(img)["rect"]
    assert abs(x - 600) <= 16 and abs(y - 300) <= 16
    assert abs(w - 2560) <= 24 and abs(h - 1440) <= 24
