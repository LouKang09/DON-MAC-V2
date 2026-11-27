import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
APK = Path("/app/donmac-attendance-test.apk")
class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self): self.serve(False)
    def do_GET(self): self.serve(True)
    def serve(self, body):
        if self.path == "/health":
            self.send_response(200 if APK.is_file() else 503)
            self.end_headers()
            return
        if self.path != "/donmac-attendance-test.apk" or not APK.is_file():
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.android.package-archive")
        self.send_header("Content-Length", str(APK.stat().st_size))
        self.send_header("Content-Disposition", 'attachment; filename="donmac-attendance-test.apk"')
        self.send_header("Access-Control-Allow-Origin", "https://donmacpos.com")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if body:
            with APK.open("rb") as f:
                while chunk := f.read(65536): self.wfile.write(chunk)
ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
