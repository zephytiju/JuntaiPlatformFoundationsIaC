"""Copy projected files into per-role 0700 directories / 0600 files before boot.

Kubernetes Secret projections are root-owned; opaque host custody deliberately
rejects those permissions. This init process is the only writer of these volumes.
Service containers mount only their own completed directory, read-only.
"""

import argparse
import json
import os
from pathlib import Path
import re


def stage(source, destination, roles, data=None):
    if os.geteuid() != 0 or not re.fullmatch(r"nous-full-host-t[0-9]+", os.environ.get("POD_NAMESPACE", "")):
        raise ValueError("disposable pod file staging requires its root init process")
    for role, uid in roles.items():
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,40}", role) or type(uid) is not int or not 21000 < uid < 21100:
            raise ValueError("exact role identity required")
        if data is not None:
            writable = Path(data) / role
            if writable.exists():
                if not writable.is_dir() or list(writable.iterdir()) or writable.is_symlink():
                    raise ValueError("fresh per-role data volume required")
                writable.chmod(0o700)
                os.chown(writable, uid, uid)
        target = Path(destination) / role
        if not target.is_dir() or list(target.iterdir()):
            raise ValueError("fresh per-role volume required")
        for file in (Path(source) / role).iterdir():
            # Kubernetes atomic projection metadata is not a consumer file.
            if file.name.startswith(".."):
                continue
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", file.name):
                raise ValueError("flat projected file required")
            content = file.read_bytes()
            if len(content) > 800_000:
                raise ValueError("configuration file too large")
            output = target / file.name
            fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fchmod(stream.fileno(), 0o600)
                os.fchown(stream.fileno(), uid, uid)
        target.chmod(0o700)
        os.chown(target, uid, uid)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--roles", required=True)
    parser.add_argument("--data")
    args = parser.parse_args()
    stage(args.source, args.destination, json.loads(args.roles), args.data)
