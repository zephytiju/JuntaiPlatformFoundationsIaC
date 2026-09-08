"""Platform-owned runtime integrity gate, called before a domain's readiness gate.

Distribution integrity is independent of live Meridian validation. The service
must additionally start Meridian and verify configured Binding, capability and
schema/resource fingerprints with the public runtime before becoming ready.
"""

import argparse
import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import platform
import sys


class RuntimeDistributionError(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise RuntimeDistributionError(code)


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def read_json(path):
    raw = Path(path).read_bytes()
    require(len(raw) <= 4 * 1024 * 1024, "RUNTIME_DESCRIPTOR_LIMIT")
    return raw, json.loads(raw)


def verify(descriptor_path=None, *, expected_descriptor_digest=None, embedded=False):
    """A deployed service must supply its exact platform-projected descriptor pin."""
    root = Path(__file__).resolve().parent
    raw, inventory = read_json(root / "runtime-manifest.json")
    require(
        inventory["format"] == "juntai.platform.meridian-runtime-inventory/v1",
        "RUNTIME_INVENTORY_FORMAT",
    )
    profile = inventory["profile"]
    if not embedded:
        require(
            descriptor_path and expected_descriptor_digest,
            "RUNTIME_DESCRIPTOR_REQUIRED",
        )
        descriptor_bytes, descriptor = read_json(descriptor_path)
        require(
            sha(descriptor_bytes) == expected_descriptor_digest,
            "RUNTIME_DESCRIPTOR_MISMATCH",
        )
        require(
            descriptor["format"] == "juntai.platform.meridian-runtime-distribution/v1",
            "RUNTIME_DESCRIPTOR_FORMAT",
        )
        require(
            descriptor["inventoryDigest"] == sha(raw), "RUNTIME_DISTRIBUTION_MISMATCH"
        )
        require(descriptor["pythonAbi"] == profile["pythonAbi"], "RUNTIME_ABI_MISMATCH")
        require(
            descriptor["profileId"] == profile["profileId"], "RUNTIME_PROFILE_MISMATCH"
        )
        require(
            descriptor["entryPointContract"] == profile["entryPointContract"],
            "RUNTIME_ENTRYPOINT_CONTRACT_MISMATCH",
        )
        require(
            descriptor["packages"] == inventory["packages"],
            "RUNTIME_PACKAGE_SET_MISMATCH",
        )
    require(
        platform.python_version() == profile["pythonVersion"], "RUNTIME_PYTHON_MISMATCH"
    )
    require(sys.implementation.cache_tag == "cpython-312", "RUNTIME_ABI_MISMATCH")
    require(
        sys.platform == "linux" and platform.machine() == "x86_64",
        "RUNTIME_PLATFORM_MISMATCH",
    )
    require(
        sha((root / "requirements.txt").read_bytes())
        == inventory["requirementsSha256"],
        "RUNTIME_LOCK_MISMATCH",
    )
    require(
        sha((root / "constraints.txt").read_bytes()) == inventory["constraintsSha256"],
        "RUNTIME_CONSTRAINTS_MISMATCH",
    )
    require(
        sha((root / "python-sbom.cdx.json").read_bytes())
        == inventory["pythonSbomSha256"],
        "RUNTIME_SBOM_MISMATCH",
    )
    require(
        sha(Path(__file__).read_bytes()) == inventory["verifierSha256"],
        "RUNTIME_VERIFIER_MISMATCH",
    )
    require(
        sha((root / "bindings.py").read_bytes()) == inventory["bindingsSha256"],
        "RUNTIME_BINDINGS_DRIFT",
    )
    expected_names = {
        item["name"].lower().replace("_", "-") for item in inventory["packages"]
    }
    for dist in metadata.distributions():
        name = dist.metadata["Name"].lower().replace("_", "-")
        # Extra domain/observability schema plugins are allowed; replacing the
        # selected storage distribution or adding another adapter is not.
        adapter_entries = [
            ep for ep in dist.entry_points if ep.group == "meridian_storage.adapters"
        ]
        require(
            not adapter_entries or name in expected_names, "RUNTIME_UNSELECTED_ADAPTER"
        )
    for package in inventory["packages"]:
        require(
            metadata.version(package["name"]) == package["version"],
            "RUNTIME_PACKAGE_VERSION_DRIFT",
        )
    prefix = Path(sys.prefix).resolve()
    for relative, expected in inventory["files"].items():
        path = (prefix / relative).resolve()
        require(
            path.is_relative_to(prefix) and path.is_file(),
            "RUNTIME_PACKAGE_FILE_MISSING",
        )
        require(sha(path.read_bytes()) == expected, "RUNTIME_PACKAGE_FILE_DRIFT")
    for group, expected in profile["entryPointContract"]["required"].items():
        entries = metadata.entry_points(group=group)
        for name, value in expected.items():
            selected = [ep for ep in entries if ep.name == name]
            require(
                len(selected) == 1 and selected[0].value == value,
                "RUNTIME_ENTRYPOINT_DRIFT",
            )
            selected[0].load()
    return {
        "inventoryDigest": sha(raw),
        "profileId": profile["profileId"],
        "pythonAbi": profile["pythonAbi"],
        "sourceRevision": inventory["sourceRevision"],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--embedded", action="store_true")
    parser.add_argument("--descriptor")
    parser.add_argument("--descriptor-digest")
    arguments = parser.parse_args()
    try:
        print(
            json.dumps(
                verify(
                    arguments.descriptor,
                    expected_descriptor_digest=arguments.descriptor_digest,
                    embedded=arguments.embedded,
                )
            )
        )
    except Exception as error:
        print(
            error
            if isinstance(error, RuntimeDistributionError)
            else "RUNTIME_DISTRIBUTION_INVALID",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
