"""Real Linux namespace policy unit checks; no IAM or native admission claim."""

import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import threading


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def child(uid, code):
    def identity():
        os.setgroups([])
        os.setgid(uid)
        os.setuid(uid)
    return subprocess.run([sys.executable, "-c", code], preexec_fn=identity, capture_output=True, timeout=3)


def run():
    plan = json.loads(Path("/plan.json").read_text())
    sealer = module("sealer", "/owner/seal-full-host-network.py")
    stager = module("stager", "/owner/stage-full-host-files.py")
    subprocess.run(["ip", "link", "add", "probe0", "type", "dummy"], check=True)
    sealer.seal("/plan.json", plan["policySha256"], "/out/receipt.json")
    vectors = [
        (21002, 9446, True), (21002, 9447, False),
        (21005, 9447, True), (21005, 9446, False),
        (21002, 8000, False), (21005, 8000, False),
        (21001, 8000, True), (21004, 8000, True), (21007, 8000, True),
        (21009, 9443, True), (21009, 9446, False), (21009, 9447, False),
        (21008, 15432, False), (21010, 9446, False), (21010, 9447, False),
        (21002, 9843, True), (21012, 9843, True), (21020, 9443, False),
        (21099, 9443, False), (21003, 15433, True), (21002, 15433, False),
        (21002, 9443, True), (21005, 9443, True), (21012, 9443, True),
        (21008, 9443, True), (21010, 9443, True),
        (21009, 19443, False), (21099, 19443, False),
        (21002, 4318, True), (21002, 4317, True), (21002, 8443, True),
        (21023, 18180, True), (21023, 8443, True),
        (21002, 18180, False), (21012, 18180, False), (21009, 4318, False),
        (21005, 8443, False), (21032, 9443, False),
    ]
    servers, stop = [], threading.Event()
    def serve(server):
        while not stop.is_set():
            try:
                stream, _ = server.accept()
                with stream:
                    stream.sendall(str(server.getsockname()[1]).encode())
            except (TimeoutError, OSError):
                pass
    try:
        for port in sorted({row[1] for row in vectors} | {19443}):
            server = socket.socket()
            server.bind(("127.0.0.1", port))
            server.listen()
            server.settimeout(0.1)
            servers.append(server)
            threading.Thread(target=serve, args=(server,), daemon=True).start()
        results = []
        for uid, port, expected in vectors:
            target = next((row["targetPort"] for row in plan["issuerRedirects"] if row["uid"] == uid and row["port"] == port), port)
            probe = child(uid, f"import socket; s=socket.socket(); s.settimeout(.15); s.connect(('127.0.0.1',{port})); assert s.recv(20)==b'{target}'; s.close()")
            actual = probe.returncode == 0
            if actual != expected:
                raise AssertionError(f"kernel UID {uid} port {port}: expected {expected}, got {actual}")
            results.append({"uid": uid, "port": port, "allowed": actual, "receiverPort": target if actual else None})
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp.bind(("127.0.0.1", 9446))
        udp.settimeout(0.2)
        try:
            child(21002, "import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.sendto(b'unit',('127.0.0.1',9446))")
            try:
                udp.recv(10)
                raise AssertionError("unplanned UDP packet reached listener")
            except TimeoutError:
                pass
        finally:
            udp.close()
        for role in ("nous", "lattice"):
            (Path("/out/source") / role).mkdir(parents=True)
            (Path("/out/material") / role).mkdir(parents=True)
            (Path("/out/source") / role / "unit-marker").write_text("offline unit data")
        Path("/out/data/nous").mkdir(parents=True)
        stager.stage("/out/source", "/out/material", {"nous": 21002, "lattice": 21005}, "/out/data")
        assert child(21002, "from pathlib import Path; Path('/out/data/nous/probe').write_text('unit')").returncode == 0
        assert child(21005, "from pathlib import Path; Path('/out/data/nous/probe').read_text()").returncode != 0
        for role, uid in (("nous", 21002), ("lattice", 21005)):
            folder = Path("/out/material") / role
            assert folder.stat().st_uid == uid and stat.S_IMODE(folder.stat().st_mode) == 0o700
            metadata = child(uid, f"import stat; from pathlib import Path; s=Path('/out/material/{role}/unit-marker').stat(); assert s.st_uid=={uid} and stat.S_IMODE(s.st_mode)==0o600")
            assert metadata.returncode == 0
        own = child(21002, "from pathlib import Path; Path('/out/material/nous/unit-marker').read_bytes()")
        other = child(21005, "from pathlib import Path; Path('/out/material/nous/unit-marker').read_bytes()")
        assert own.returncode == 0 and other.returncode != 0
        capability = child(21002, "from pathlib import Path; s=Path('/proc/self/status').read_text(); assert 'CapEff:\\t0000000000000000' in s")
        assert capability.returncode == 0
        print(json.dumps({"kind": "isolated-linux-kernel-unit", "nativeAdmission": False,
            "networkReceipt": json.loads(Path("/out/receipt.json").read_text()),
            "tcpVectors": results, "udpDenied": True, "custodyOwnershipAndCrossRoleDenial": True,
            "serviceEffectiveCapabilitiesEmpty": True, "plan": plan,
            "observedRules": json.loads(subprocess.check_output(["nft", "-j", "list", "ruleset"], timeout=10))}, indent=2))
    finally:
        stop.set()
        for server in servers:
            server.close()


if __name__ == "__main__":
    run()
