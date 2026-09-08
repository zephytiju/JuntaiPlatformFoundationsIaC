"""Build-time inventory of the exact installed public runtime wheels."""

import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlparse


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def write(path, value):
    Path(path).write_text(
        json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n"
    )


def main(source):
    assert re.fullmatch(r"[0-9a-f]{40}", source), "exact source revision required"
    root = Path(__file__).resolve().parent
    profile = json.loads((root / "profile.json").read_text())
    report = json.loads((root / "installation-report.json").read_text())
    prefix = Path(sys.prefix).resolve()
    packages, files = [], {}
    for item in report["install"]:
        download = item["download_info"]
        url = urlparse(download["url"])
        assert url.scheme == "https" and url.hostname == "files.pythonhosted.org"
        assert url.path.endswith(".whl") and not url.query and not url.fragment
        name, version = item["metadata"]["name"], item["metadata"]["version"]
        dist = metadata.distribution(name)
        assert dist.version == version
        wheel_sha = download["archive_info"]["hashes"]["sha256"]
        assert re.fullmatch(r"[0-9a-f]{64}", wheel_sha)
        packages.append(
            {
                "name": name,
                "version": version,
                "url": download["url"],
                "sha256": wheel_sha,
            }
        )
        for entry in dist.files or ():
            path = Path(dist.locate_file(entry)).resolve()
            if path.suffix == ".pyc":
                continue
            assert path.is_relative_to(prefix) and path.is_file()
            files[str(path.relative_to(prefix))] = sha(path.read_bytes())
    packages.sort(key=lambda value: value["name"])
    (root / "constraints.txt").write_text(
        "".join(f"{item['name']}=={item['version']}\n" for item in packages)
    )
    write(
        root / "python-sbom.cdx.json",
        {
            "bomFormat": "CycloneDX",
            "specVersion": "1.5",
            "version": 1,
            "metadata": {
                "component": {
                    "type": "container",
                    "name": "juntai-platform-meridian-runtime-python",
                    "version": profile["version"],
                }
            },
            "components": [
                {
                    "type": "library",
                    "name": p["name"],
                    "version": p["version"],
                    "purl": f"pkg:pypi/{p['name']}@{p['version']}",
                    "hashes": [{"alg": "SHA-256", "content": p["sha256"]}],
                }
                for p in packages
            ],
        },
    )
    write(
        root / "runtime-manifest.json",
        {
            "format": "juntai.platform.meridian-runtime-inventory/v1",
            "profile": profile,
            "sourceRevision": source,
            "packages": packages,
            "files": files,
            "requirementsSha256": sha((root / "requirements.txt").read_bytes()),
            "constraintsSha256": sha((root / "constraints.txt").read_bytes()),
            "pythonSbomSha256": sha((root / "python-sbom.cdx.json").read_bytes()),
            "verifierSha256": sha((root / "verify.py").read_bytes()),
        },
    )


if __name__ == "__main__":
    main(sys.argv[1])
