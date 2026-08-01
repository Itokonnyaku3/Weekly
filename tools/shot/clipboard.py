"""画像を Windows のクリップボードへ置く。

CF_DIB（24bit）で入れる。Word・Excel・Teams・Outlook はこれで確実に貼り付けられる。
BMP のファイルヘッダ(14バイト)を落としたものが、そのまま DIB の中身になる。
"""

from __future__ import annotations

import ctypes
import io
from pathlib import Path

from PIL import Image

from winapi import CF_DIB, GMEM_MOVEABLE, kernel32, user32


class ClipboardError(RuntimeError):
    pass


def _to_dib(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="BMP")
    return buf.getvalue()[14:]


def copy_image(img: Image.Image) -> None:
    data = _to_dib(img)

    hmem = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
    if not hmem:
        raise ClipboardError("メモリを確保できません")
    ptr = kernel32.GlobalLock(hmem)
    if not ptr:
        kernel32.GlobalFree(hmem)
        raise ClipboardError("メモリをロックできません")
    ctypes.memmove(ptr, data, len(data))
    kernel32.GlobalUnlock(hmem)

    if not user32.OpenClipboard(None):
        kernel32.GlobalFree(hmem)
        raise ClipboardError("クリップボードを開けません（他のアプリが使用中）")
    try:
        user32.EmptyClipboard()
        if not user32.SetClipboardData(CF_DIB, hmem):
            kernel32.GlobalFree(hmem)
            raise ClipboardError("クリップボードに書き込めません")
        # 成功したらメモリの所有権は OS に移る。GlobalFree してはいけない。
    finally:
        user32.CloseClipboard()


def copy_file(path: Path) -> None:
    with Image.open(path) as img:
        copy_image(img)
