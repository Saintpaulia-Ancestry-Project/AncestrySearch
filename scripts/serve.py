"""Serve the site/ folder locally and open it in the browser.

Browsers will not load the SQLite file from a page opened as a plain file, so run this instead:
    python scripts/serve.py            (any Python 3; no packages needed)
    python scripts/serve.py --port 8080 --no-browser
"""
import argparse
import functools
import http.server
import socketserver
import threading
import webbrowser
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".wasm": "application/wasm", ".sqlite": "application/octet-stream",
                      ".js": "text/javascript", ".mjs": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")  # always pick up a rebuilt database
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    if not (SITE / "avancestry.sqlite").exists():
        raise SystemExit("site/avancestry.sqlite not found. Build it first: python scripts/build_db.py")
    socketserver.TCPServer.allow_reuse_address = True
    handler = functools.partial(Handler, directory=str(SITE))
    with socketserver.TCPServer(("127.0.0.1", args.port), handler) as httpd:
        url = f"http://127.0.0.1:{args.port}/"
        print(f"Serving {SITE} at {url}  (Ctrl+C to stop)")
        if not args.no_browser:
            threading.Timer(0.5, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
