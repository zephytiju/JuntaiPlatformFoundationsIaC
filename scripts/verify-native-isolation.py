"""Qualify namespace rules, private custody and pinned Envoy syntax in unit containers.

No Kubernetes allocation, Casdoor identity, application service or native admission.
Both test containers have network=none; model/API traffic is not performed.
"""

import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


def command(args, *, timeout=180):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, cwd=ROOT)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr[-4000:]}")
    return result.stdout


def verify():
    owned = []
    with tempfile.TemporaryDirectory(prefix="nous-isolation-unit-") as folder:
        temp = Path(folder)
        proxies = temp / "proxies"
        proxies.mkdir()
        plan = temp / "plan.json"
        command(["node", "--import", "tsx", "scripts/native-network-test-plan.ts", str(plan), str(proxies)])
        images = json.loads((proxies / "images.json").read_text())
        try:
            kernel = "nous-isolation-kernel-unit-" + uuid.uuid4().hex[:12]
            owned.append(kernel)
            args = ["docker", "run", "--rm", "--name", kernel, "--network", "none", "--user", "0",
                "--cap-drop", "ALL", "--cap-add", "NET_ADMIN", "--cap-add", "CHOWN", "--cap-add", "SETUID", "--cap-add", "SETGID",
                "--read-only", "--tmpfs", "/out:rw,noexec,nosuid,size=2m,mode=0755",
                "--env", "POD_NAMESPACE=nous-full-host-t100340", "--env", "POD_UID=00000000-0000-4000-8000-000000000001",
                "--mount", f"type=bind,src={ROOT}/release,dst=/owner,readonly",
                "--mount", f"type=bind,src={ROOT}/tests/native_network_kernel.py,dst=/test.py,readonly",
                "--mount", f"type=bind,src={plan},dst=/plan.json,readonly",
                "--entrypoint", "python3", images["sealer"], "/test.py"]
            kernel_evidence = json.loads(command(args))
            # Deliberately untrusted, throwaway certificates for syntax loading
            # only. Never exported as deployment trust or used by native IAM.
            command(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                "-subj", "/CN=offline-unit.invalid", "-addext", "subjectAltName=DNS:iam.m4.invalid", "-keyout", str(proxies / "server-key.pem"), "-out", str(proxies / "server-chain.pem")])
            (proxies / "server-key.pem").chmod(0o600)
            (proxies / "reader-ca.pem").write_bytes((proxies / "server-chain.pem").read_bytes())
            modulus = command(["openssl", "x509", "-in", str(proxies / "server-chain.pem"), "-noout", "-modulus"]).strip().split("=", 1)[1]
            public_key = {"kty": "RSA", "kid": "offline-unit", "alg": "RS256", "use": "sig", "e": "AQAB",
                "n": base64.urlsafe_b64encode(bytes.fromhex(modulus)).decode().rstrip("=")}
            (proxies / "issuer-jwks.json").write_text(json.dumps({"keys": [public_key]}))
            proxy_evidence = []
            for role in ("nousReader", "latticeReader", "issuerProxy", "latticeProxy", "nousProxy", "consoleProxy"):
                name = "nous-isolation-envoy-unit-" + uuid.uuid4().hex[:12]
                owned.append(name)
                result = command(["docker", "run", "--rm", "--name", name, "--network", "none",
                    "--user", f"{os.getuid()}:{os.getgid()}", "--cap-drop", "ALL", "--read-only",
                    "--mount", f"type=bind,src={proxies},dst=/run/m4,readonly",
                    "--entrypoint", "/usr/local/bin/envoy", images["proxy"],
                    "-c", f"/run/m4/{role}.json", "--mode", "validate", "--disable-hot-restart", "--log-level", "critical"])
                proxy_evidence.append({"role": role, "status": "PASS", "output": result.strip()})
            # The following key is a throwaway unit key, readable by the fixed
            # proxy UID only through this test's isolated mount. Production
            # custody is separately checked at 0600 in the kernel unit above.
            (proxies / "server-key.pem").chmod(0o644)
            holder = "nous-issuer-holder-unit-" + uuid.uuid4().hex[:12]
            owned.append(holder)
            command(["docker", "run", "-d", "--rm", "--name", holder, "--network", "none", "--user", "0",
                "--cap-drop", "ALL", "--cap-add", "NET_ADMIN", "--cap-add", "SETUID", "--cap-add", "SETGID",
                "--read-only", "--tmpfs", "/out:rw,noexec,nosuid,size=1m",
                "--env", "POD_NAMESPACE=nous-full-host-t100340", "--env", "POD_UID=00000000-0000-4000-8000-000000000001",
                "--mount", f"type=bind,src={ROOT}/release,dst=/owner,readonly",
                "--mount", f"type=bind,src={ROOT}/tests/native_issuer_kernel.py,dst=/issuer-test.py,readonly",
                "--mount", f"type=bind,src={plan},dst=/plan.json,readonly",
                "--mount", f"type=bind,src={proxies},dst=/unit-tls,readonly",
                "--entrypoint", "python3", images["sealer"], "/issuer-test.py", "serve"])
            issuer = "nous-issuer-proxy-unit-" + uuid.uuid4().hex[:12]
            owned.append(issuer)
            command(["docker", "run", "-d", "--rm", "--name", issuer, "--network", "container:" + holder,
                "--user", "21007:21007", "--cap-drop", "ALL", "--read-only",
                "--mount", f"type=bind,src={proxies},dst=/run/m4,readonly",
                "--entrypoint", "/usr/local/bin/envoy", images["proxy"], "-c", "/run/m4/issuerProxy.json",
                "--disable-hot-restart", "--concurrency", "1", "--log-level", "critical"])
            def probe(uid, method="GET", path="/.well-known/jwks", body="", headers=None):
                return json.loads(command(["docker", "exec", holder, "python3", "/issuer-test.py", "probe",
                    "--uid", str(uid), "--method", method, "--path", path, "--body", body, "--headers", json.dumps(headers or {})], timeout=10))
            deadline = time.monotonic() + 30
            while True:
                try:
                    if probe(21002)["status"] == 200:
                        break
                except RuntimeError:
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError("isolated synthetic issuer did not start")
                time.sleep(0.25)
            issuer_evidence = []
            for uid in (21002, 21005, 21012):
                for method, path, body, headers, expected in [
                    ("GET", "/.well-known/jwks", "", {}, 200),
                    ("POST", "/api/login/oauth/access_token", "{}", {"Content-Type": "application/json"}, 200),
                    ("GET", "/api/get-user?id=unit/other", "", {"Authorization": "Bearer offline-unit", "X-Source-Role": "browser"}, 403),
                    ("GET", "/.well-known/jwks", "", {"Authorization": "Bearer offline-unit"}, 403),
                    ("GET", "/.well-known/jwks", "", {"Cookie": "unit=1"}, 403),
                    ("GET", "/.well-known/jwks", "", {"Origin": "https://console.m4.invalid:9448"}, 403),
                    ("POST", "/api/login/oauth/access_token", "code=unit", {"Content-Type": "application/x-www-form-urlencoded"}, 403),
                ]:
                    result = probe(uid, method, path, body, headers)
                    if result["status"] != expected:
                        raise AssertionError(f"issuer route {uid} {method} {path}: {result['status']} != {expected}")
                    issuer_evidence.append(result)
            for uid in (21008, 21009, 21010):
                result = probe(uid, path="/api/get-user?id=unit/other")
                assert result["status"] == 200
                issuer_evidence.append(result)
            print(json.dumps({"scope": "owner unit qualification only", "nativeAdmission": False,
                "images": images, "kernel": kernel_evidence, "proxySyntax": proxy_evidence,
                "syntheticIssuerRouting": issuer_evidence}, indent=2))
        finally:
            for name in reversed(owned):
                # Exact invocation-owned names only, including timeout/error cleanup.
                subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=20)


if __name__ == "__main__":
    verify()
