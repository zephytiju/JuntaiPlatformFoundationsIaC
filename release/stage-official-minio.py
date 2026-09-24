"""Stage the unchanged official public MinIO binary before network isolation."""

import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import time
import urllib.request


class HTTPSOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.startswith("https://"):
            raise ValueError("artifact redirect must use HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def stage(manifest, destination):
    architecture = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine(), platform.machine())
    if architecture not in ("amd64", "arm64"):
        raise ValueError("unsupported MinIO architecture")
    artifact = manifest["architectures"][architecture]
    expected_url = (
        "https://github.com/minio/minio/releases/download/"
        "RELEASE.2025-04-22T22-12-26Z/"
        f"minio.linux-{architecture}.RELEASE.2025-04-22T22-12-26Z"
    )
    if artifact["url"] != expected_url or manifest["release"] != "RELEASE.2025-04-22T22-12-26Z":
        raise ValueError("exact official MinIO release required")
    target = Path(destination)
    target.mkdir(mode=0o700)  # Reject existing directories and symlinks.
    output = target / "minio.part"
    digest, count, deadline = hashlib.sha256(), 0, time.monotonic() + 600
    opener = urllib.request.build_opener(HTTPSOnlyRedirect())
    try:
        with opener.open(expected_url, timeout=60) as response, output.open("xb") as stream:
            while chunk := response.read(1024 * 1024):
                count += len(chunk)
                if count > artifact["bytes"] or time.monotonic() > deadline:
                    raise ValueError("artifact exceeded size or download deadline")
                stream.write(chunk)
                digest.update(chunk)
        if count != artifact["bytes"] or digest.hexdigest() != artifact["sha256"]:
            raise ValueError("official artifact SHA256 or byte length mismatch")
        output.chmod(0o500)
        output.rename(target / "minio")
        receipt = target / "receipt.json"
        receipt.write_text(json.dumps({
            "release": manifest["release"], "architecture": architecture,
            "sha256": digest.hexdigest(), "bytes": count, "uid": os.getuid(),
            "url": expected_url, "originalImage": manifest["originalImage"],
        }, sort_keys=True) + "\n")
        receipt.chmod(0o400)
        target.chmod(0o500)
    except BaseException:
        for name in ("minio.part", "minio", "receipt.json"):
            (target / name).unlink(missing_ok=True)
        target.rmdir()
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--destination", required=True)
    args = parser.parse_args()
    stage(json.loads(Path(args.manifest).read_text()), args.destination)
