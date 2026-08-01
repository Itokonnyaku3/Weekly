"""ビューア用のローカルサーバ。

常駐プロセスの中でデーモンスレッドとして 127.0.0.1 にだけバインドする。
外からは見えない。標準ライブラリだけで動く。
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import threading
from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from PIL import Image

import autocrop
import clipboard
import imageops
import storage

HERE = Path(__file__).resolve().parent
VIEWER_DIR = HERE / "viewer"

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NAME_RE = re.compile(r"^\d{3,}_\d{6}\.png$")

STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/viewer.css": ("viewer.css", "text/css; charset=utf-8"),
    "/viewer.js": ("viewer.js", "text/javascript; charset=utf-8"),
}

log = logging.getLogger("shot.server")


class NotFound(Exception):
    pass


class BadRequest(Exception):
    pass


# 上書き前の画像を何枚ぶん覚えておくか（Ctrl+Z 用。プロセスを終えると消える）
UNDO_DEPTH = 5


class Api:
    """HTTP から切り離した処理本体。root と設定だけに依存する。"""

    def __init__(self, root: Path, cfg: dict):
        self.root = root
        self.cfg = cfg
        # 編集は元ファイルを上書きするので、直前の状態だけメモリに退避しておく。
        # ディスク上のファイルは増やさない。
        self._undo: deque[tuple[str, str, bytes]] = deque(maxlen=UNDO_DEPTH)
        self._lock = threading.Lock()

    # -- パスの検証 --

    def resolve(self, date: str, name: str) -> Path:
        """日付とファイル名を検証してから実ファイルの場所を返す。

        正規表現で形を縛ることで、`..` を含むパスがそもそも通らないようにする。
        """
        if not DATE_RE.match(date or "") or not NAME_RE.match(name or ""):
            raise NotFound(f"不正なパス: {date}/{name}")
        path = self.root / date / name
        if not path.is_file():
            raise NotFound(f"見つかりません: {date}/{name}")
        return path

    # -- 一覧 --

    def dates(self) -> dict:
        return {
            "dates": [{"date": d, "count": c} for d, c in storage.list_days(self.root)]
        }

    def shots(self, date: str) -> dict:
        if not DATE_RE.match(date or ""):
            raise NotFound(f"不正な日付: {date}")
        day = self.root / date
        index = storage.load_index(day)["shots"]
        gap = max(0, int(self.cfg.get("group_gap_minutes", 30))) * 60

        out = []
        prev: datetime | None = None
        for name in storage.list_shots(day):
            meta = self._ensure_size(day, name, index.get(name, {}))
            ts = self._timestamp(date, name, meta)
            entry = {
                "name": name,
                "no": int(name.split("_")[0]),
                "time": ts.strftime("%H:%M:%S"),
                "ts": ts.isoformat(timespec="seconds"),
                "w": meta.get("w", 0),
                "h": meta.get("h", 0),
                "note": meta.get("note", ""),
                # 直前の撮影から間があいたら、一覧で区切り線を引く
                "gap": prev is None or (ts - prev).total_seconds() >= gap,
            }
            # 未検出（キーが無い）と、検出したが何も無かった（null）を区別する。
            # 前者だけビューアが検出を依頼してくる。
            if "auto" in meta:
                entry["auto"] = meta["auto"]
            out.append(entry)
            prev = ts
        return {"date": date, "shots": out}

    def _ensure_size(self, day: Path, name: str, meta: dict) -> dict:
        """幅・高さが分からないエントリを、実ファイルから補って覚え直す。

        フォルダに画像を直接置いた場合や index.json を失った場合に効く。
        寸法が無いと、自動トリミングの枠をサムネのどこに重ねるか決められない。
        """
        if meta.get("w") and meta.get("h"):
            return meta
        try:
            with Image.open(day / name) as img:
                w, h = img.size
        except (OSError, ValueError):
            return meta
        return storage.update_entry(day, name, w=w, h=h)

    @staticmethod
    def _timestamp(date: str, name: str, meta: dict) -> datetime:
        """index.json があればそれを、無ければファイル名から時刻を復元する。"""
        raw = meta.get("ts")
        if raw:
            try:
                return datetime.fromisoformat(raw)
            except ValueError:
                pass
        return datetime.strptime(f"{date} {name.split('_')[1][:6]}", "%Y-%m-%d %H%M%S")

    # -- 画像 --

    def thumb(self, date: str, name: str) -> Path:
        self.resolve(date, name)
        return imageops.ensure_thumb(self.root / date, name)

    def image(self, date: str, name: str) -> Path:
        return self.resolve(date, name)

    def copy(self, date: str, name: str) -> dict:
        clipboard.copy_file(self.resolve(date, name))
        return {"ok": True}

    # -- 自動トリミングの候補 --

    def autocrop(self, date: str, name: str) -> dict:
        """スライド／ページらしい領域を探して返す。結果は index.json に覚えておく。

        1枚あたり数十msかかるので、同じ画像で二度は計算しない。
        編集すると当然変わるので、そのときに覚えた結果を捨てる（_forget_auto）。
        """
        path = self.resolve(date, name)
        day = self.root / date
        meta = storage.load_index(day)["shots"].get(name, {})
        if "auto" in meta:
            return {"auto": meta["auto"]}

        found = autocrop.detect_file(path)
        storage.update_entry(day, name, auto=found)
        return {"auto": found}

    def _forget_auto(self, date: str, name: str) -> None:
        storage.drop_fields(self.root / date, name, "auto")

    def reveal(self, date: str, name: str) -> dict:
        path = self.resolve(date, name)
        # explorer は選択できても終了コード 1 を返すことがあるので結果は見ない
        subprocess.Popen(["explorer", "/select,", str(path)])
        return {"ok": True}

    # -- メモ --

    def note(self, date: str, name: str, text: str) -> dict:
        self.resolve(date, name)
        storage.update_entry(self.root / date, name, note=str(text or ""))
        return {"ok": True}

    # -- 編集（上書き保存） --

    def edit(self, date: str, name: str, op: str, params: dict) -> dict:
        """`op` で操作を選ぶ形にしてある。描き込み注釈を足すときも
        新しい op を1つ増やすだけで、既存の呼び出しは変わらない。"""
        path = self.resolve(date, name)

        with self._lock:
            original = path.read_bytes()
            with Image.open(path) as img:
                img.load()
                if op == "crop":
                    rect = params.get("rect")
                    if not (isinstance(rect, (list, tuple)) and len(rect) == 4):
                        raise BadRequest("rect は [x, y, w, h] で指定してください")
                    out = imageops.crop(img, rect)
                elif op == "rotate":
                    out = imageops.rotate(img, params.get("degrees", 90))
                else:
                    raise BadRequest(f"未対応の操作: {op}")

            self._write(path, out)
            self._undo.append((date, name, original))
            storage.update_entry(self.root / date, name, w=out.width, h=out.height)
            self._forget_auto(date, name)  # 画像が変わったので候補は計算し直す
            return {"w": out.width, "h": out.height}

    def undo(self) -> dict:
        with self._lock:
            if not self._undo:
                raise BadRequest("戻せる編集がありません")
            date, name, data = self._undo.pop()
            path = self.root / date / name
            tmp = path.with_suffix(".png.part")
            tmp.write_bytes(data)
            os.replace(tmp, path)

            with Image.open(path) as img:
                w, h = img.size
            storage.update_entry(self.root / date, name, w=w, h=h)
            self._forget_auto(date, name)
            return {"date": date, "name": name, "w": w, "h": h}

    def delete(self, date: str, name: str) -> dict:
        self.resolve(date, name)
        storage.move_to_trash(self.root, date, name)
        return {"ok": True}

    def _write(self, path: Path, img: Image.Image) -> None:
        """書きかけの PNG を読まれないよう、一時ファイル経由で置き換える。"""
        tmp = path.with_suffix(".png.part")
        img.save(tmp, format="PNG", compress_level=self.cfg.get("png_compress_level", 1))
        os.replace(tmp, path)


class Handler(BaseHTTPRequestHandler):
    api: Api = None  # start() で差し込む
    protocol_version = "HTTP/1.1"

    # BaseHTTPRequestHandler は既定で stderr に書く。pythonw では邪魔なので黙らせる。
    def log_message(self, *args):
        pass

    # -- 応答ヘルパ --

    def _send(self, code: int, body: bytes, ctype: str, headers: dict = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data, code: int = 200):
        self._send(
            code,
            json.dumps(data, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
            {"Cache-Control": "no-store"},
        )

    def _file(self, path: Path, ctype: str, cache: bool = True):
        st = path.stat()
        etag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
        if cache and self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.end_headers()
            return
        self._send(
            200,
            path.read_bytes(),
            ctype,
            {"ETag": etag, "Cache-Control": "no-cache"} if cache else {},
        )

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError:
            return {}

    # -- ルーティング --

    def do_GET(self):
        try:
            self._route_get()
        except NotFound as e:
            self._json({"error": str(e)}, 404)
        except (BadRequest, ValueError) as e:
            self._json({"error": str(e)}, 400)
        except Exception as e:
            log.exception("GET %s", self.path)
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    def do_POST(self):
        try:
            self._route_post()
        except NotFound as e:
            self._json({"error": str(e)}, 404)
        except (BadRequest, ValueError) as e:
            self._json({"error": str(e)}, 400)
        except Exception as e:
            log.exception("POST %s", self.path)
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    def _route_get(self):
        u = urlparse(self.path)
        path, query = u.path, parse_qs(u.query)

        if path in STATIC:
            name, ctype = STATIC[path]
            return self._file(VIEWER_DIR / name, ctype, cache=False)

        if path == "/api/dates":
            return self._json(self.api.dates())

        if path == "/api/shots":
            return self._json(self.api.shots((query.get("date") or [""])[0]))

        if path == "/api/autocrop":
            return self._json(
                self.api.autocrop(
                    (query.get("date") or [""])[0], (query.get("name") or [""])[0]
                )
            )

        for prefix, kind in (("/thumb/", "thumb"), ("/img/", "img")):
            if path.startswith(prefix):
                parts = path[len(prefix):].split("/")
                if len(parts) != 2:
                    raise NotFound(path)
                date, name = parts
                if kind == "thumb":
                    return self._file(self.api.thumb(date, name), "image/jpeg")
                return self._file(self.api.image(date, name), "image/png")

        raise NotFound(path)

    def _route_post(self):
        path = urlparse(self.path).path
        body = self._body()
        date, name = body.get("date"), body.get("name")

        if path == "/api/copy":
            return self._json(self.api.copy(date, name))
        if path == "/api/reveal":
            return self._json(self.api.reveal(date, name))
        if path == "/api/note":
            return self._json(self.api.note(date, name, body.get("note", "")))
        if path == "/api/edit":
            return self._json(self.api.edit(date, name, body.get("op"), body))
        if path == "/api/undo":
            return self._json(self.api.undo())
        if path == "/api/delete":
            return self._json(self.api.delete(date, name))

        raise NotFound(path)


class ViewerServer:
    def __init__(self, root: Path, cfg: dict):
        self.cfg = cfg
        self.port = int(cfg.get("port", 8787))
        Handler.api = Api(root, cfg)
        self._httpd: ThreadingHTTPServer | None = None

    def start(self) -> int:
        self._httpd = ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        self._httpd.daemon_threads = True
        threading.Thread(
            target=self._httpd.serve_forever, name="shot-server", daemon=True
        ).start()
        return self.port

    def stop(self) -> None:
        if self._httpd:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
