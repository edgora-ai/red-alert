#!/usr/bin/env python3
"""开发/游玩静态服务器：对所有响应禁用缓存。
浏览器对 python -m http.server（无 Cache-Control 头）会启发式缓存 JS 模块，
游戏升级后极易加载到新旧混合的代码导致逻辑错乱/冻结；本服务器强制 no-cache。"""

import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # 安静模式
        pass


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with ReusableTCPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        print(f"现代红警运行中: http://localhost:{PORT}/  (Ctrl+C 停止)")
        httpd.serve_forever()
