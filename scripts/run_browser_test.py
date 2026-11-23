"""Run a site/tests/*.html page in headless Edge and print its result (no packages needed).

    .venv/Scripts/python scripts/run_browser_test.py tests/quickadd-test.html
    .venv/Scripts/python scripts/run_browser_test.py tests/quick-page-test.html --timeout 90

The page is served from site/ on a temporary port. A test page reports by setting document.title to PASS or FAIL and
filling #summary and #log. Edge is driven over the DevTools protocol (a minimal websocket client below), because
--dump-dom does not wait for the 37 MB database to load. Exit code 0 = PASS.
"""
import argparse
import base64
import functools
import http.server
import json
import os
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
EDGES = [r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"]


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm",
                      ".sqlite": "application/octet-stream", ".js": "text/javascript", ".json": "application/json"}

    def log_message(self, *a):
        pass


class WS:
    """Just enough websocket client for the DevTools protocol (text frames, client masking)."""

    def __init__(self, url):
        host, port, path = url.replace("ws://", "").split("/", 1)[0].split(":")[0], int(url.split(":")[2].split("/")[0]), "/" + url.split("/", 3)[3]
        self.s = socket.create_connection((host, port))
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(1)
        assert b" 101 " in buf.split(b"\r\n")[0], buf
        self.n = 0

    def send(self, obj):
        data = json.dumps(obj).encode()
        head = bytes([0x81])
        if len(data) < 126:
            head += bytes([0x80 | len(data)])
        elif len(data) < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", len(data))
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", len(data))
        mask = os.urandom(4)
        self.s.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _read(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.s.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("closed")
            buf += chunk
        return buf

    def recv(self):
        msg = b""
        while True:
            b1, b2 = self._read(2)
            ln = b2 & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", self._read(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(ln)
            if b1 & 0x0F in (1, 0):
                msg += payload
                if b1 & 0x80:
                    return json.loads(msg)

    def call(self, method, **params):
        self.n += 1
        self.send({"id": self.n, "method": method, "params": params})
        while True:
            r = self.recv()
            if r.get("id") == self.n:
                return r.get("result", {})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("page", help="path under site/, e.g. tests/quickadd-test.html")
    ap.add_argument("--timeout", type=int, default=90)
    a = ap.parse_args()
    edge = next((e for e in EDGES if Path(e).exists()), None)
    if not edge:
        sys.exit("Microsoft Edge not found")
    srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(SITE)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    dbg = 9300 + port % 500
    prof = tempfile.mkdtemp(prefix="edge_test_")
    proc = subprocess.Popen([edge, "--headless=new", "--disable-gpu", f"--remote-debugging-port={dbg}", f"--user-data-dir={prof}",
                             "--no-first-run", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        target = None
        for _ in range(100):
            try:
                req = urllib.request.Request(f"http://127.0.0.1:{dbg}/json/new?about:blank", method="PUT")
                target = json.load(urllib.request.urlopen(req, timeout=2))
                break
            except Exception:
                time.sleep(0.2)
        if not target:
            sys.exit("could not reach Edge")
        ws = WS(target["webSocketDebuggerUrl"])
        ws.call("Page.enable")
        ws.call("Runtime.enable")
        ws.call("Page.navigate", url=f"http://127.0.0.1:{port}/{a.page}")
        ev = lambda expr: ws.call("Runtime.evaluate", expression=expr, returnByValue=True).get("result", {}).get("value")
        title = ""
        end = time.time() + a.timeout
        while time.time() < end:
            title = ev("document.title") or ""
            if title in ("PASS", "FAIL"):
                break
            time.sleep(0.5)
        print(ev("(document.getElementById('summary')||{}).textContent") or "(no summary)")
        if title not in ("PASS", "FAIL"):
            print("TIMED OUT. Inner frame text:", (ev("(document.querySelector('iframe')||{contentDocument:null}).contentDocument && "
                  "document.querySelector('iframe').contentDocument.body.innerText.slice(0, 400)") or "(none)"))
        log = ev("(document.getElementById('log')||{}).textContent") or ""
        if log:
            print(log)
        sys.exit(0 if title == "PASS" else 1)
    finally:
        proc.kill()
        srv.shutdown()


if __name__ == "__main__":
    main()
