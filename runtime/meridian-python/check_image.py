"""Offline native-image integrity and fail-closed acceptance; no Engine connection."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def main(image):
    base = [
        "docker",
        "run",
        "--rm",
        "--platform=linux/amd64",
        "--read-only",
        "--cap-drop=ALL",
        "--network=none",
    ]
    verify = "/opt/juntai/meridian-runtime/verify.py"
    read = ["--entrypoint=python", image, "-c"]
    raw = subprocess.check_output(
        base
        + read
        + [
            "from pathlib import Path;import sys;sys.stdout.buffer.write("
            "Path('/opt/juntai/meridian-runtime/runtime-manifest.json').read_bytes())"
        ]
    )
    inventory = json.loads(raw)
    profile = inventory["profile"]
    assert (
        subprocess.check_output(base + read + ["import os;print(os.getuid())"]).strip()
        == b"65532"
    )
    subprocess.run(base + [image], check=True)
    with tempfile.TemporaryDirectory(
        prefix="meridian-runtime-acceptance-"
    ) as temporary:
        root = Path(temporary)
        descriptor = {
            "format": "juntai.platform.meridian-runtime-distribution/v1",
            "inventoryDigest": "sha256:" + hashlib.sha256(raw).hexdigest(),
            "pythonAbi": profile["pythonAbi"],
            "profileId": profile["profileId"],
            "entryPointContract": profile["entryPointContract"],
            "packages": inventory["packages"],
        }
        path = root / "descriptor.json"
        path.write_text(json.dumps(descriptor))
        pin = "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
        command = base + [
            "--mount",
            f"type=bind,src={root},dst=/fixtures,readonly",
            "--entrypoint=python",
            image,
            verify,
        ]
        subprocess.run(
            command
            + ["--descriptor", "/fixtures/descriptor.json", "--descriptor-digest", pin],
            check=True,
        )

        def denied(args, code, *, extra=()):
            result = subprocess.run(
                base + list(extra) + ["--entrypoint=python", image, verify] + args,
                capture_output=True,
                text=True,
            )
            assert result.returncode == 1 and code in result.stderr, result

        denied([], "RUNTIME_DESCRIPTOR_REQUIRED")
        mount = ["--mount", f"type=bind,src={root},dst=/fixtures,readonly"]
        denied(
            [
                "--descriptor",
                "/fixtures/descriptor.json",
                "--descriptor-digest",
                "sha256:" + "0" * 64,
            ],
            "RUNTIME_DESCRIPTOR_MISMATCH",
            extra=mount,
        )
        (root / "wrong-lock.txt").write_text("tampered\n")
        denied(
            ["--embedded"],
            "RUNTIME_LOCK_MISMATCH",
            extra=[
                "--mount",
                f"type=bind,src={root / 'wrong-lock.txt'},dst=/opt/juntai/meridian-runtime/requirements.txt,readonly",
            ],
        )
        package_path = next(
            path
            for path in inventory["files"]
            if path.endswith("/meridian_storage/__init__.py")
        )
        (root / "tampered.py").write_text("# modified runtime package\n")
        denied(
            ["--embedded"],
            "RUNTIME_PACKAGE_FILE_DRIFT",
            extra=[
                "--mount",
                f"type=bind,src={root / 'tampered.py'},dst=/usr/local/{package_path},readonly",
            ],
        )
        rogue = root / "unselected_adapter-0.0.0.dist-info"
        rogue.mkdir()
        (rogue / "METADATA").write_text(
            "Metadata-Version: 2.1\nName: unselected-adapter\nVersion: 0.0.0\n"
        )
        (rogue / "entry_points.txt").write_text(
            "[meridian_storage.adapters]\nrogue = os:path\n"
        )
        denied(
            ["--embedded"],
            "RUNTIME_UNSELECTED_ADAPTER",
            extra=mount + ["--env", "PYTHONPATH=/fixtures"],
        )
    print(
        "Runtime integrity accepted; missing pin, descriptor/lock/file drift and unselected adapter rejected"
    )


if __name__ == "__main__":
    main(sys.argv[1])
