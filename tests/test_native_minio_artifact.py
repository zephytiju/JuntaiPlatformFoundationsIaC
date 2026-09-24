"""Corrupt or untrusted artifacts must never become a full-host executable."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("stage_minio", ROOT / "release/stage-official-minio.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MinioStagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.target = Path(self.temporary.name) / "verified"
        self.manifest = json.loads((ROOT / "release/minio-official-artifact.v1.json").read_text())
        self.payload = b"unchanged test artifact"

    def run_stage(self, payload, architecture="amd64"):
        artifact = self.manifest["architectures"][architecture]
        artifact["bytes"] = len(self.payload)
        artifact["sha256"] = hashlib.sha256(self.payload).hexdigest()
        opener = Mock()
        opener.open.return_value = io.BytesIO(payload)
        with patch.object(module.platform, "machine", return_value=architecture), patch.object(module.urllib.request, "build_opener", return_value=opener):
            module.stage(self.manifest, self.target)

    def test_verified_platforms_are_executable_and_receipted(self):
        for architecture in ("amd64", "arm64"):
            with self.subTest(architecture=architecture):
                self.target = Path(self.temporary.name) / architecture
                self.run_stage(self.payload, architecture)
                self.assertEqual((self.target / "minio").read_bytes(), self.payload)
                self.assertEqual((self.target / "minio").stat().st_mode & 0o777, 0o500)
                self.assertEqual(self.target.stat().st_mode & 0o777, 0o500)
                self.assertEqual(json.loads((self.target / "receipt.json").read_text())["architecture"], architecture)
                self.target.chmod(0o700)  # Allow test-owned temporary cleanup.

    def test_hash_mismatch_cleans_all_partial_files(self):
        with self.assertRaisesRegex(ValueError, "mismatch"):
            self.run_stage(b"changed! test artifact")
        self.assertFalse(self.target.exists())

    def test_oversized_download_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "exceeded size"):
            self.run_stage(self.payload + b"extra")
        self.assertFalse(self.target.exists())

    def test_truncated_download_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "mismatch"):
            self.run_stage(self.payload[:3])
        self.assertFalse(self.target.exists())

    def test_unapproved_source_rejected(self):
        self.manifest["architectures"]["amd64"]["url"] = "https://example.org/minio"
        with self.assertRaisesRegex(ValueError, "official MinIO"):
            self.run_stage(self.payload)
        self.assertFalse(self.target.exists())

    def test_existing_destination_rejected(self):
        self.target.mkdir()
        with self.assertRaises(FileExistsError):
            self.run_stage(self.payload)

    def test_https_downgrade_rejected(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            module.HTTPSOnlyRedirect().redirect_request(None, None, 302, "", {}, "http://example.org")

    def test_unsupported_architecture_rejected(self):
        with patch.object(module.platform, "machine", return_value="ppc64le"), self.assertRaisesRegex(ValueError, "unsupported"):
            module.stage(self.manifest, self.target)
        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main()
