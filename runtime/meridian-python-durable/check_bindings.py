"""Offline context-isolation and projected-file tests; never connects to an Engine."""

from datetime import UTC, datetime, timedelta
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from meridian_storage.context import OperationContext, bind_context
from meridian_storage.runtime import SecretReference


path = Path(__file__).with_name("bindings.py")
if not path.exists():
    path = Path("/opt/juntai/meridian-runtime/bindings.py")
spec = importlib.util.spec_from_file_location("platform_bindings", path)
bindings = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bindings)


class BindingsTests(unittest.TestCase):
    def test_projected_rotation_and_regular_file_boundary(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first, second, link = root / "first", root / "second", root / "current"
            first.write_bytes(b"first")
            second.write_bytes(b"second")
            link.symlink_to(first)
            ref = SecretReference("file", str(link))
            resolver = bindings.ProjectedFiles()
            self.assertEqual(resolver.resolve(ref).reveal(), b"first")
            link.unlink()
            link.symlink_to(second)
            self.assertEqual(resolver.resolve(ref).reveal(), b"second")
            second.write_bytes(b"")
            with self.assertRaises(ValueError):
                resolver.resolve(ref)
            with self.assertRaises(ValueError):
                resolver.resolve(SecretReference("environment", "TOKEN"))
            with self.assertRaises(ValueError):
                resolver.resolve(SecretReference("file", "relative"))
            with self.assertRaises(ValueError):
                resolver.resolve(SecretReference("file", str(root)))

    def test_repository_context_is_per_request_and_construction_has_no_io(self):
        selected = SimpleNamespace(
            id="metadata",
            endpoint="host=database.invalid dbname=prism",
            tls=SimpleNamespace(
                mode="server",
                server_name="database.invalid",
                ca_ref=SecretReference("file", "/projected/ca"),
            ),
            client=SimpleNamespace(operation_timeout_ms=5000),
        )
        settings = SimpleNamespace(
            resources={"metadata": SimpleNamespace(profile="metadata-registry")},
            physical_schema="metadata",
            application_name="probe",
        )
        with (
            patch.object(
                bindings,
                "load_runtime_config_from_environment",
                return_value=SimpleNamespace(bindings=(selected,)),
            ),
            patch.object(bindings, "Meridian") as meridian,
            patch.object(
                bindings.PostgreSQLSettings, "from_binding", return_value=settings
            ),
            patch.object(bindings, "PostgreSQLSchemaRepository") as repository,
            patch.object(bindings.psycopg, "connect") as connect,
        ):
            runtime, schema_api = bindings.create_bindings(
                {"MERIDIAN_METADATA_BINDING": "metadata"}
            )
            self.assertIs(runtime, meridian.return_value)
            with self.assertRaises(Exception):
                schema_api()
            for tenant in ("one", "two", "one"):
                with bind_context(
                    OperationContext(
                        tenant=tenant,
                        scope={"project": tenant},
                        principal_ref="verified",
                        deadline=datetime.now(UTC) + timedelta(seconds=5),
                    )
                ):
                    schema_api()
            contexts = [call.kwargs["context"] for call in repository.call_args_list]
            self.assertEqual([c.tenant for c in contexts], ["one", "two", "one"])
            self.assertEqual(
                [dict(c.scope) for c in contexts],
                [{"project": v} for v in ("one", "two", "one")],
            )
            self.assertIsNot(contexts[0], contexts[2])
            connect.assert_not_called()
            selected.tls.mode = "disabled"
            with self.assertRaisesRegex(ValueError, "AUTHENTICATED_TLS"):
                bindings.create_bindings({"MERIDIAN_METADATA_BINDING": "metadata"})
            connect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
