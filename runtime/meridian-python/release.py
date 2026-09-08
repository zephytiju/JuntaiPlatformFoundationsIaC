"""Export a verified official image and its attached SBOM/provenance by digest."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def main():
    image, source = os.environ["RUNTIME_IMAGE"], os.environ["GITHUB_SHA"]
    require_image = (
        r"ghcr.io/zephytiju/juntai-platform-meridian-runtime-python@sha256:[0-9a-f]{64}"
    )
    assert re.fullmatch(require_image, image)
    assert re.fullmatch(r"[0-9a-f]{40}", source)
    profile = json.loads(Path("runtime/meridian-python/profile.json").read_text())
    assert (
        os.environ["GITHUB_REF_NAME"]
        == "meridian-runtime-python-v" + profile["version"]
    )
    inspected = json.loads(
        subprocess.check_output(["docker", "image", "inspect", image])
    )[0]
    assert image in inspected["RepoDigests"]
    labels = inspected["Config"]["Labels"]
    assert labels["org.opencontainers.image.revision"] == source
    assert labels["org.opencontainers.image.version"] == profile["version"]
    output = Path("runtime-release")
    output.mkdir(exist_ok=True)
    for name in (
        "runtime-manifest.json",
        "python-sbom.cdx.json",
        "requirements.txt",
        "constraints.txt",
    ):
        raw = subprocess.check_output(
            [
                "docker",
                "run",
                "--rm",
                "--read-only",
                "--cap-drop=ALL",
                "--network=none",
                "--entrypoint=python",
                image,
                "-c",
                f"from pathlib import Path;import sys;sys.stdout.buffer.write(Path('/opt/juntai/meridian-runtime/{name}').read_bytes())",
            ]
        )
        (output / name).write_bytes(raw)
    inventory = json.loads((output / "runtime-manifest.json").read_text())
    assert inventory["profile"] == profile and inventory["sourceRevision"] == source
    assert (output / "requirements.txt").read_bytes() == Path(
        "runtime/meridian-python/requirements.txt"
    ).read_bytes()
    for field, filename, content in (
        ("SBOM", "image-sbom.spdx.json", "SPDX"),
        ("Provenance", "image-provenance.slsa.json", "SLSA"),
    ):
        raw = subprocess.check_output(
            [
                "docker",
                "buildx",
                "imagetools",
                "inspect",
                image,
                "--format",
                "{{json ." + field + "}}",
            ]
        )
        value = json.loads(raw)
        selected = value.get("linux/amd64", value)
        assert selected.get(content), f"missing attached {field}"
        (output / filename).write_text(
            json.dumps(selected[content], sort_keys=True) + "\n"
        )
    sbom = json.loads((output / "image-sbom.spdx.json").read_text())
    assert sbom["spdxVersion"].startswith("SPDX-2.") and sbom["packages"]
    provenance = json.loads((output / "image-provenance.slsa.json").read_text())
    assert provenance.get("buildType") or provenance.get("buildDefinition"), (
        "invalid SLSA predicate"
    )
    url = (
        "https://github.com/zephytiju/JuntaiPlatformFoundationsIaC/releases/download/"
        + os.environ["GITHUB_REF_NAME"]
        + "/"
    )

    def artifact(name):
        return {"url": url + name, "digest": sha((output / name).read_bytes())}

    descriptor = {
        "format": "juntai.platform.meridian-runtime-distribution/v1",
        "version": profile["version"],
        "capability": profile["capability"],
        "image": image,
        "profileId": profile["profileId"],
        "pythonAbi": profile["pythonAbi"],
        "pythonVersion": profile["pythonVersion"],
        "platform": profile["platform"],
        "baseImage": profile["baseImage"],
        "sourceRevision": source,
        "inventoryDigest": sha((output / "runtime-manifest.json").read_bytes()),
        "inventory": artifact("runtime-manifest.json"),
        "lock": artifact("requirements.txt"),
        "constraints": artifact("constraints.txt"),
        "packages": inventory["packages"],
        "entryPointContract": profile["entryPointContract"],
        "sbom": artifact("image-sbom.spdx.json"),
        "pythonSbom": artifact("python-sbom.cdx.json"),
        "provenance": artifact("image-provenance.slsa.json"),
        "workflow": "https://github.com/"
        + os.environ["GITHUB_REPOSITORY"]
        + "/actions/runs/"
        + os.environ["GITHUB_RUN_ID"],
    }
    (output / "runtime-distribution.v1.json").write_text(
        json.dumps(descriptor, sort_keys=True, indent=2) + "\n"
    )
    (output / "SHA256SUMS").write_text(
        "".join(
            hashlib.sha256(p.read_bytes()).hexdigest() + "  " + p.name + "\n"
            for p in sorted(output.iterdir())
            if p.is_file() and p.name != "SHA256SUMS"
        )
    )
    print(
        json.dumps(
            {"image": image, "descriptor": artifact("runtime-distribution.v1.json")}
        )
    )


if __name__ == "__main__":
    main()
