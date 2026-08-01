import pytest
from PIL import Image

import imageops


@pytest.fixture
def img():
    # 200x100。左上に赤い 10x10 の目印を置き、回転で位置が追えるようにする
    im = Image.new("RGB", (200, 100), (30, 60, 90))
    im.paste((255, 0, 0), (0, 0, 10, 10))
    return im


def test_トリミングは指定矩形どおりに切れる(img):
    out = imageops.crop(img, (50, 20, 40, 30))
    assert out.size == (40, 30)


def test_トリミングは画像外にはみ出しても内側に収める(img):
    out = imageops.crop(img, (180, 90, 100, 100))
    assert out.size == (20, 10)


def test_トリミングは負の座標を0に丸める(img):
    out = imageops.crop(img, (-30, -20, 60, 50))
    assert out.size == (30, 30)


def test_トリミングは幅0でも1px残す(img):
    out = imageops.crop(img, (10, 10, 0, 0))
    assert out.size == (1, 1)


def test_90度回転で幅と高さが入れ替わる(img):
    assert imageops.rotate(img, 90).size == (100, 200)


def test_180度回転では寸法が変わらない(img):
    assert imageops.rotate(img, 180).size == (200, 100)


def test_時計回りに90度回すと左上の目印が右上へ移る(img):
    out = imageops.rotate(img, 90)
    assert out.getpixel((out.width - 5, 5)) == (255, 0, 0)
    assert out.getpixel((5, 5)) != (255, 0, 0)


def test_反時計回り270度は時計回り90度を3回と一致する(img):
    a = imageops.rotate(img, 270)
    b = imageops.rotate(imageops.rotate(imageops.rotate(img, 90), 90), 90)
    assert a.tobytes() == b.tobytes()


def test_0度と360度は何もしない(img):
    assert imageops.rotate(img, 0) is img
    assert imageops.rotate(img, 360) is img


def test_90の倍数でない回転は拒否する(img):
    with pytest.raises(ValueError):
        imageops.rotate(img, 45)


def test_サムネは指定幅に収まり縦横比を保つ():
    im = Image.new("RGB", (1920, 1080))
    t = imageops.make_thumb(im, width=460)
    assert t.size == (460, 259)


def test_サムネは元画像より小さくしない():
    im = Image.new("RGB", (300, 200))
    t = imageops.make_thumb(im, width=920)
    assert t.size == (300, 200)


def test_サムネはファイルに書き出され再利用される(tmp_path):
    day = tmp_path / "2026-08-01"
    day.mkdir()
    Image.new("RGB", (1920, 1080), (10, 20, 30)).save(day / "001_120000.png")

    first = imageops.ensure_thumb(day, "001_120000.png")
    assert first.exists()
    stamp = first.stat().st_mtime_ns

    second = imageops.ensure_thumb(day, "001_120000.png")
    assert second == first
    assert second.stat().st_mtime_ns == stamp  # 作り直していない


def test_元画像が新しくなればサムネを作り直す(tmp_path):
    import os

    day = tmp_path / "2026-08-01"
    day.mkdir()
    src = day / "001_120000.png"
    Image.new("RGB", (1920, 1080), (10, 20, 30)).save(src)
    thumb = imageops.ensure_thumb(day, "001_120000.png")
    before = thumb.stat().st_size

    # 編集された想定：縦長に差し替え、更新時刻を進める
    Image.new("RGB", (400, 1200), (200, 30, 30)).save(src)
    os.utime(src, (thumb.stat().st_mtime + 10, thumb.stat().st_mtime + 10))

    imageops.ensure_thumb(day, "001_120000.png")
    from PIL import Image as I

    with I.open(thumb) as t:
        assert t.width == 400  # 元が幅920未満なのでそのまま
    assert thumb.stat().st_size != before
