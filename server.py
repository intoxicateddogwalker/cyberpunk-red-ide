#!/usr/bin/env python3
"""Optional local server for CYBERPUNK RED IDE.

Serves the IDE pages AND offers a real local shell over a WebSocket
at /shell, for use on your own computer only.

SECURITY — READ THIS:
  * This server binds to 127.0.0.1 (localhost) by default. It serves an
    UNAUTHENTICATED shell: anyone who can reach it can run commands as you.
  * NEVER bind it to 0.0.0.0, never put it on the internet, never port
    forward to it. Localhost only, on a computer you control.
  * If you start it with --host 0.0.0.0 anyway, that is on you.

Usage:
    python3 server.py            # http://127.0.0.1:8765
    python3 server.py --port 9000

Standard library only. No dependencies.
"""

import argparse
import base64
import hashlib
import http.server
import json
import mimetypes
import os
import pty
import select
import socket
import struct
import subprocess
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

INDEX_FILES = {"index.html", "styles.css", "app.js"}


class WSConnection:
    """Minimal RFC 6455 server-side WebSocket over a raw socket."""

    def __init__(self, sock, key):
        self.sock = sock
        self.key = key
        self.buf = b""
        self.closed = False

    def handshake(self):
        accept = base64.b64encode(
            hashlib.sha1((self.key + WS_GUID).encode()).digest()
        ).decode()
        resp = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
        )
        self.sock.sendall(resp.encode())

    def _recv_exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("peer closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv_message(self):
        """Returns (opcode, payload bytes). Raises on close/error."""
        b1, b2 = self._recv_exact(2)
        fin = b1 & 0x80
        opcode = b1 & 0x0F
        masked = b2 & 0x80
        length = b2 & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._recv_exact(8))[0]
        mask = self._recv_exact(4) if masked else b""
        payload = self._recv_exact(length) if length else b""
        if masked:
            payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
        if opcode == 0x9:  # ping -> pong
            self.send_frame(payload, opcode=0xA)
            return self.recv_message()
        if opcode == 0x8:  # close
            raise ConnectionError("client closed")
        if opcode == 0x0:  # continuation: keep reading (we only handle single frames)
            raise ConnectionError("fragmented frames unsupported")
        if not fin:
            raise ConnectionError("fragmented frames unsupported")
        return opcode, payload

    def send_frame(self, payload, opcode=0x1):
        if isinstance(payload, str):
            payload = payload.encode("utf-8", "replace")
        header = bytearray([0x80 | opcode])
        length = len(payload)
        if length < 126:
            header.append(length)
        elif length < 65536:
            header.append(126)
            header += struct.pack(">H", length)
        else:
            header.append(127)
            header += struct.pack(">Q", length)
        self.sock.sendall(bytes(header) + payload)

    def close(self):
        try:
            self.send_frame(b"", opcode=0x8)
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass
        self.closed = True


def run_shell(ws):
    """Run an interactive shell in a pty, bridging it to the WebSocket."""
    shell = os.environ.get("SHELL", "/bin/bash")
    master, slave = pty.openpty()
    try:
        proc = subprocess.Popen(
            [shell, "-i"],
            stdin=slave,
            stdout=slave,
            stderr=slave,
            preexec_fn=os.setsid,
            close_fds=True,
        )
    except OSError as exc:
        ws.send_frame(f"\r\n[server] could not start shell: {exc}\r\n")
        os.close(master)
        os.close(slave)
        return
    os.close(slave)
    os.set_blocking(master, False)
    stop = threading.Event()

    def pump_output():
        while not stop.is_set():
            try:
                r, _, _ = select.select([master], [], [], 0.1)
            except (OSError, ValueError):
                break
            if not r:
                continue
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            try:
                ws.send_frame(data.decode("utf-8", "replace"))
            except (OSError, ConnectionError):
                break
        stop.set()

    reader = threading.Thread(target=pump_output, daemon=True)
    reader.start()
    try:
        while not stop.is_set():
            try:
                opcode, payload = ws.recv_message()
            except (ConnectionError, OSError):
                break
            if opcode == 0x1:
                try:
                    os.write(master, payload)
                except OSError:
                    break
    finally:
        stop.set()
        try:
            proc.terminate()
        except OSError:
            pass
        try:
            os.close(master)
        except OSError:
            pass
        reader.join(timeout=2)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # keep stdout quiet-ish
        sys.stderr.write("[ide] " + fmt % args + "\n")

    def _send_file(self, name):
        if name not in INDEX_FILES:
            self.send_error(404, "not found")
            return
        path = os.path.join(HERE, name)
        ctype, _ = mimetypes.guess_type(name)
        with open(path, "rb") as fh:
            data = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/health":
            body = json.dumps({"ok": True, "shell": True}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/shell":
            key = self.headers.get("Sec-WebSocket-Key")
            if not key:
                self.send_error(400, "websocket upgrade required")
                return
            ws = WSConnection(self.connection, key.strip())
            try:
                ws.handshake()
            except OSError:
                return
            run_shell(ws)
            ws.close()
            return
        name = self.path.lstrip("/").split("?", 1)[0] or "index.html"
        self._send_file(name)


def main():
    ap = argparse.ArgumentParser(description="CYBERPUNK RED IDE local server (localhost only)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    if args.host not in ("127.0.0.1", "::1", "localhost"):
        print("WARNING: binding to a non-localhost address exposes an",
              "UNAUTHENTICATED shell. Do not do this on shared networks.",
              file=sys.stderr)
    srv = http.server.ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"CYBERPUNK RED IDE at http://{args.host}:{args.port}/  (localhost only)")
    print("Press Ctrl-C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")


if __name__ == "__main__":
    main()
