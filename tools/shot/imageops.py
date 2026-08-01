"""画像の加工。副作用のない純粋関数として書き、テストしやすくしている。

座標はすべて「原寸ピクセル」。ビューア側が表示倍率から換算して渡してくる。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

import storage

# サムネの生成幅。表示は 460px 想定で、HiDPI でも滲まないよう 2倍で持つ。
THUMB_WIDTH = 920
THUMB_QUALITY = 80


def clamp_rect(rect, size) -> tuple[int, int, int, int]:
    """(x, y, w, h) を画像内に収めて (left, top, right, bottom) にする。

    ビューアから来る座標は表示倍率の丸め誤差でわずかに画像外へはみ出すことがある。
    はみ出しは切り捨て、幅・高さは最低 1px を保証する。
    """
    x, y, w, h = (int(round(v)) for v in rect)
    iw, ih = size

    left = max(0, min(x, iw - 1))
    top = max(0, min(y, ih - 1))
    right = max(left + 1, min(x + w, iw))
    bottom = max(top + 1, min(y + h, ih))
    return left, top, right, bottom


def crop(img: Image.Image, rect) -> Image.Image:
    return img.crop(clamp_rect(rect, img.size))


def rotate(img: Image.Image, degrees: int) -> Image.Image:
    """90 の倍数で回転する。時計回りを正とする。"""
    d = int(degrees) % 360
    if d == 0:
        return img
    if d not in (90, 180, 270):
        raise ValueError(f"90 の倍数のみ対応しています: {degrees}")
    # PIL の transpose は反時計回り基準なので対応表で読み替える
    return img.transpose(
        {
            90: Image.Transpose.ROTATE_270,
            180: Image.Transpose.ROTATE_180,
            270: Image.Transpose.ROTATE_90,
        }[d]
    )


def make_thumb(img: Image.Image, width: int = THUMB_WIDTH) -> Image.Image:
    if img.width <= width:
        return img.convert("RGB")
    height = max(1, round(img.height * width / img.width))
    return img.convert("RGB").resize((width, height), Image.LANCZOS)


# --- ディスク上のサムネ ---------------------------------------------------


def thumb_path(day: Path, name: str) -> Path:
    return day / storage.THUMBS_DIRNAME / (Path(name).stem + ".jpg")


def ensure_thumb(day: Path, name: str) -> Path:
    """サムネが無い、または元画像より古ければ作り直す。"""
    src = day / name
    dst = thumb_path(day, name)
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return dst

    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as img:
        thumb = make_thumb(img)
    tmp = dst.with_suffix(".jpg.part")
    thumb.save(tmp, format="JPEG", quality=THUMB_QUALITY, optimize=True)
    tmp.replace(dst)
    return dst


def drop_thumb(day: Path, name: str) -> None:
    thumb_path(day, name).unlink(missing_ok=True)
