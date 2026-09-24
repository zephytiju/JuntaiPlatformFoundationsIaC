"""Explicit public-file gate before an approved proxy activation; no secret reads."""
import hashlib
import json
import ssl
from pathlib import Path


def verify_public_trust(trust, directory):
    root = Path(directory)
    files = {
        "caSha256": ("reader-ca.pem", False),
        "jwksSha256": ("issuer-jwks.json", False),
        "serverCertificateSha256": ("server-chain.pem", True),
        "clientCertificateSha256": ("client-cert.pem", True),
    }
    for key, (name, certificate) in files.items():
        raw = (root / name).read_bytes()
        if len(raw) > 1_000_000 or b"PRIVATE KEY" in raw:
            raise ValueError("invalid public trust material")
        if certificate:
            raw = ssl.PEM_cert_to_DER_cert(raw.decode("ascii"))
        if "sha256:" + hashlib.sha256(raw).hexdigest() != trust[key]:
            raise ValueError("public trust digest mismatch")
    jwks = json.loads((root / "issuer-jwks.json").read_bytes())
    if not jwks.get("keys") or any(set(k) & {"d", "p", "q", "dp", "dq", "qi", "k"} for k in jwks["keys"]):
        raise ValueError("public JWKS required")
    return True


if __name__ == "__main__":
    import sys
    artifact = json.loads(Path(sys.argv[1]).read_bytes())
    verify_public_trust(artifact["trust"], sys.argv[2])
    print("public trust bytes verified; native admission remains NOT RUN")
