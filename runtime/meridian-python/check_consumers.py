"""Reproduce a hash-locked service overlay without changing the platform runtime.

Private consumer wheels are ephemeral test inputs and never published in the
public base image or its release assets. Network is used only to fetch pinned
wheels; installation and the installed-code probe both run network-disabled.
"""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen


def sha(raw):
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def download(package, destination):
    filename = package["filename"]
    assert re.fullmatch(r"[A-Za-z0-9_.+-]+\.whl", filename)
    assert re.fullmatch(r"[0-9a-f]{64}", package["sha256"])
    path = destination / filename
    url = urlsplit(package["url"])
    assert url.scheme == "https" and not (
        url.username or url.password or url.query or url.fragment
    )
    if not path.exists():
        if url.hostname == "github.com":
            parts = url.path.strip("/").split("/")
            assert len(parts) == 6 and parts[2:4] == ["releases", "download"]
            assert parts[5] == filename and parts[0] == "zephytiju"
            subprocess.run(
                [
                    "gh",
                    "release",
                    "download",
                    parts[4],
                    "--repo",
                    "/".join(parts[:2]),
                    "--pattern",
                    filename,
                    "--dir",
                    str(destination),
                ],
                check=True,
                capture_output=True,
            )
        else:
            assert url.hostname == "files.pythonhosted.org"
            with urlopen(package["url"], timeout=60) as response:
                path.write_bytes(response.read())
    assert sha(path.read_bytes()) == "sha256:" + package["sha256"], filename


def main(image, output, cache):
    source = Path(__file__).resolve().parent
    lock_raw = (source / "consumer-lock.json").read_bytes()
    lock = json.loads(lock_raw)
    cache.mkdir(parents=True, exist_ok=True)
    for package in lock["packages"]:
        download(package, cache)
    base = [
        "docker",
        "run",
        "--rm",
        "--platform=linux/amd64",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--network=none",
    ]
    raw = subprocess.check_output(
        base
        + [
            "--entrypoint=cat",
            image,
            "/opt/juntai/meridian-runtime/runtime-manifest.json",
        ]
    )
    inventory = json.loads(raw)
    descriptor = {
        "format": "juntai.platform.meridian-runtime-distribution/v1",
        "inventoryDigest": sha(raw),
        **{
            k: inventory["profile"][k]
            for k in ("pythonAbi", "profileId", "entryPointContract")
        },
        "packages": inventory["packages"],
    }
    with tempfile.TemporaryDirectory(prefix="runtime-consumer-") as temporary:
        root = Path(temporary)
        (root / "wheels").mkdir()
        for package in lock["packages"]:
            shutil.copyfile(
                cache / package["filename"], root / "wheels" / package["filename"]
            )
        (root / "consumer-lock.json").write_bytes(lock_raw)
        shutil.copyfile(source / "consumer_probe.py", root / "consumer_probe.py")
        descriptor_raw = (json.dumps(descriptor, sort_keys=True) + "\n").encode()
        (root / "descriptor.json").write_bytes(descriptor_raw)
        (root / "requirements.txt").write_text(
            "".join(
                f"{p['name']}=={p['version']} --hash=sha256:{p['sha256']}\n"
                for p in lock["packages"]
            )
        )
        (root / "Dockerfile").write_text("""ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
COPY . /probe
RUN python -m pip install --no-cache-dir --no-index --no-deps --require-hashes --find-links=/probe/wheels -c /opt/juntai/meridian-runtime/constraints.txt -r /probe/requirements.txt && python -m pip check && python /opt/juntai/meridian-runtime/verify.py --embedded
USER 65532:65532
""")
        iid = root / "image.id"
        subprocess.run(
            [
                "docker",
                "build",
                "--platform=linux/amd64",
                "--network=none",
                "--build-arg",
                f"BASE_IMAGE={image}",
                "--iidfile",
                str(iid),
                str(root),
            ],
            check=True,
        )
        consumer = iid.read_text().strip()
        try:
            subprocess.run(
                base + ["--entrypoint=python", consumer, "-m", "pip", "check"],
                check=True,
            )
            result = json.loads(
                subprocess.check_output(
                    base
                    + [
                        "--env",
                        "DESCRIPTOR_DIGEST=" + sha(descriptor_raw),
                        "--entrypoint=python",
                        consumer,
                        "/probe/consumer_probe.py",
                    ]
                )
            )
            result.update(
                {
                    "format": "juntai.platform.runtime-consumer-compatibility/v1",
                    "baseImage": image,
                    "consumerImageId": consumer,
                    "consumerLockDigest": sha(lock_raw),
                    "network": "none",
                    "install": "hash-locked wheels, no index, no dependency substitution",
                    "scope": "Installed-code packaging compatibility; live service/Engine lifecycle is downstream-owned.",
                }
            )
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n")
            print(
                f"Accepted {len(result['importedModules'])} installed service modules; evidence: {output}"
            )
        finally:
            subprocess.run(
                ["docker", "image", "rm", consumer], check=True, capture_output=True
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("image")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    main(args.image, args.output, args.cache)
