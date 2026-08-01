"""スクリーンショットの中から「スライド／ページらしい明るい矩形」を見つける。

PowerPoint や PDF を全画面で撮ることが多いので、その領域を提案するための検出。
自動では切らない。確信が持てないときは何も返さない（誤検出で邪魔をしないほうがよい）。

やり方は2段階：
  1. 粗い格子に落として「明るい画素の最大の連結成分」を取り、だいたいの位置を掴む
  2. その周りだけを細かく見て、上下左右の境界を詰める

行や列の明るさプロファイルだけで探すと、画面のどこかにある白いウィンドウや
サムネイル一覧に引きずられて、まるで違う場所を指す。連結成分なら「一続きの紙」を
そのまま掴めるし、スライドの中に大きな写真が貼ってあっても、左右の余白が
つながっているので分断されない。

OpenCV は入れない。依存は numpy だけ。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

# 境界を詰めるときの作業解像度。4K でも数十msで終わる。
WORK_LONG_SIDE = 1000
# 連結成分を探すときの粗い解像度。ここは速さ優先でよい（位置が分かればよい）。
POOL_LONG_SIDE = 200
# これ以上明るい画素を「紙・スライドの地の色」とみなす
BRIGHT_LEVEL = 230
# 候補の内側がこの割合以上明るくないと、明るいものが散らばっているだけとみなす。
# 大きな図やスクリーンショットを貼ったスライドは半分近くが暗くなるので、
# ここを厳しくしすぎると本来拾いたいものを落とす。
# 位置の確からしさは連結成分が、種類の確からしさは縦横比が担保している。
MIN_DENSITY = 0.45
# 内側に文字や図がこの割合以上ないと、ただの白い面とみなす
MIN_CONTENT = 0.004
# 画面に対してこれより小さい領域は提案しない
MIN_AREA_RATIO = 0.15
# 画面のほとんどを占めるなら切っても何も変わらないので提案しない。
# デスクトップ全体（タスクバーを除いた範囲）を拾ってしまうのを防ぐ意味もある。
MAX_AREA_RATIO = 0.85

# スライドやページとして知られた縦横比に合うときだけ提案する（許容 4%）。
# 「明るくて大きい矩形」だけを条件にすると、ウィンドウの白い本文欄や
# デスクトップ全体まで拾ってしまい、ほぼ全部の画像にバッジが出て邪魔になる。
ASPECTS = (
    ("16:9 スライド", 16 / 9),
    ("4:3 スライド", 4 / 3),
    ("A4 横", 1.4142),
    ("A4 縦", 1 / 1.4142),
)
ASPECT_TOLERANCE = 0.04


EDGE_LEVEL = 0.3  # 端を詰めるときに「まだ紙の内側」とみなす明るさの割合


def _extent(profile: np.ndarray, threshold: float = EDGE_LEVEL) -> tuple[int, int] | None:
    """しきい値を超える最初と最後の位置を返す。終了は含まない。

    途中が落ち込んでいても構わない。紙の中に写真や見出しがあれば列や行の
    明るさは当然下がるが、紙の外側の縁はまず明るいので、両端だけを見ればよい。
    離れた別の明るい領域を巻き込む心配は、呼ぶ前に連結成分で位置を絞ってあるので無い。
    """
    idx = np.flatnonzero(profile >= threshold)
    if idx.size == 0:
        return None
    return int(idx[0]), int(idx[-1]) + 1


def _largest_component(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    """True の最大の連結成分の外接矩形を (x0, y0, x1, y1) で返す。上下左右4近傍。"""
    height, width = mask.shape
    seen = np.zeros_like(mask)
    best = None
    best_size = 0

    for start_y, start_x in zip(*np.nonzero(mask)):
        if seen[start_y, start_x]:
            continue
        stack = [(int(start_y), int(start_x))]
        seen[start_y, start_x] = True
        size = 0
        x0 = x1 = int(start_x)
        y0 = y1 = int(start_y)

        while stack:
            y, x = stack.pop()
            size += 1
            x0, x1 = min(x0, x), max(x1, x)
            y0, y1 = min(y0, y), max(y1, y)
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))

        if size > best_size:
            best_size = size
            best = (x0, y0, x1 + 1, y1 + 1)

    return best


def _classify(width: int, height: int) -> str | None:
    ratio = width / height
    for name, target in ASPECTS:
        if abs(ratio - target) / target <= ASPECT_TOLERANCE:
            return name
    return None


def _work_image(img: Image.Image) -> tuple[np.ndarray, float]:
    scale = max(img.width, img.height) / WORK_LONG_SIDE
    if scale <= 1:
        return np.asarray(img.convert("L")), 1.0
    small = img.convert("L").resize(
        (max(1, round(img.width / scale)), max(1, round(img.height / scale))),
        Image.BILINEAR,
    )
    return np.asarray(small), scale


def _coarse_box(bright: np.ndarray) -> tuple[int, int, int, int] | None:
    """粗い格子で最大の明るい塊を探し、作業解像度の外接矩形にして返す。"""
    height, width = bright.shape
    ratio = max(height, width) / POOL_LONG_SIDE
    if ratio <= 1:
        return _largest_component(bright)

    pw, ph = max(1, round(width / ratio)), max(1, round(height / ratio))
    pooled = np.asarray(
        Image.fromarray(bright.astype(np.uint8) * 255).resize((pw, ph), Image.BILINEAR)
    ) >= 128
    box = _largest_component(pooled)
    if box is None:
        return None
    x0, y0, x1, y1 = box
    # 粗い分だけ広めに戻し、次の段で境界を詰める
    return (
        max(0, int(x0 * ratio) - 2),
        max(0, int(y0 * ratio) - 2),
        min(width, int(round(x1 * ratio)) + 2),
        min(height, int(round(y1 * ratio)) + 2),
    )


def detect(img: Image.Image) -> dict | None:
    """見つかれば {"rect": [x, y, w, h], "kind": str, "confidence": float}。

    rect は元画像のピクセル座標。見つからなければ None。
    """
    gray, scale = _work_image(img)
    if gray.size == 0:
        return None
    bright = gray >= BRIGHT_LEVEL
    if not bright.any():
        return None

    coarse = _coarse_box(bright)
    if coarse is None:
        return None
    cx0, cy0, cx1, cy1 = coarse
    window = bright[cy0:cy1, cx0:cx1]
    if window.size == 0:
        return None

    # 粗い格子のぶん外側に余裕を持たせてあるので、その余りを詰めるだけでよい。
    rows = _extent(window.mean(axis=1))
    cols = _extent(window.mean(axis=0))
    if rows is None or cols is None:
        return None

    y0, y1 = cy0 + rows[0], cy0 + rows[1]
    x0, x1 = cx0 + cols[0], cx0 + cols[1]
    w, hgt = x1 - x0, y1 - y0
    if w < 2 or hgt < 2:
        return None

    density = float(bright[y0:y1, x0:x1].mean())
    content = float((gray[y0:y1, x0:x1] < 128).mean())
    area_ratio = (w * hgt) / gray.size

    if density < MIN_DENSITY or content < MIN_CONTENT:
        return None
    if not (MIN_AREA_RATIO <= area_ratio <= MAX_AREA_RATIO):
        return None

    # 既知の書式に合わないものは黙って見送る。確信のない提案は邪魔にしかならない。
    kind = _classify(w, hgt)
    if kind is None:
        return None

    return {
        "rect": [
            int(round(x0 * scale)),
            int(round(y0 * scale)),
            int(round(w * scale)),
            int(round(hgt * scale)),
        ],
        "kind": kind,
        "confidence": round(min(1.0, density * 0.9 + 0.1), 2),
    }


def detect_file(path) -> dict | None:
    with Image.open(path) as img:
        img.load()
        return detect(img)
