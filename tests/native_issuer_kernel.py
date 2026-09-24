"""Synthetic issuer routing unit. The upstream deliberately has no native IAM."""

import argparse
import http.client
from http.server import BaseHTTPRequestHandler, HTTPServer
import importlib.util
import json
import os
from pathlib import Path
import socket
import ssl


def serve():
    spec = importlib.util.spec_from_file_location("sealer", "/owner/seal-full-host-network.py")
    sealer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sealer)
    plan = json.loads(Path("/plan.json").read_text())
    sealer.seal("/plan.json", plan["policySha256"], "/out/receipt.json")
    class UnitUpstream(BaseHTTPRequestHandler):
        def reply(self):
            self.rfile.read(int(self.headers.get("content-length", "0")))
            body = b'{"scope":"synthetic routing unit; not native IAM"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        do_GET = reply
        do_POST = reply
        def log_message(self, *_):
            pass
    HTTPServer(("127.0.0.1", 8000), UnitUpstream).serve_forever()


def probe(uid, method, path, body, headers):
    if uid not in {21002, 21005, 21008, 21009, 21010, 21012, 21099}:
        raise ValueError("unit role only")
    os.setgroups([])
    os.setgid(uid)
    os.setuid(uid)
    class LoopbackTLS(http.client.HTTPSConnection):
        def connect(self):
            self.sock = self._context.wrap_socket(socket.create_connection(("127.0.0.1", 9443), self.timeout), server_hostname="iam.m4.invalid")
    context = ssl.create_default_context(cafile="/unit-tls/server-chain.pem")
    connection = LoopbackTLS("iam.m4.invalid", 9443, timeout=2, context=context)
    try:
        connection.request(method, path, body=body or None, headers=json.loads(headers))
        response = connection.getresponse()
        response.read()
        print(json.dumps({"uid": uid, "method": method, "path": path, "status": response.status}))
    finally:
        connection.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("serve", "probe"))
    parser.add_argument("--uid", type=int)
    parser.add_argument("--method", default="GET")
    parser.add_argument("--path", default="/.well-known/jwks")
    parser.add_argument("--body", default="")
    parser.add_argument("--headers", default="{}")
    args = parser.parse_args()
    if args.mode == "serve":
        serve()
    else:
        probe(args.uid, args.method, args.path, args.body, args.headers)
