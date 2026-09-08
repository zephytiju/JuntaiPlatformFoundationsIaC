"""Installed-wheel compatibility probe; contains no service composition or policy."""

import hashlib
import importlib
import inspect
import json
import os
import pkgutil
import sys
from importlib import metadata
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
from pydantic import BaseModel


def main():
    root = Path("/opt/juntai/meridian-runtime")
    sys.path.insert(0, str(root))
    from verify import verify

    integrity = verify(
        "/probe/descriptor.json",
        expected_descriptor_digest=os.environ["DESCRIPTOR_DIGEST"],
    )
    assert os.getuid() == 65532
    assert os.statvfs("/").f_flag & os.ST_RDONLY
    lock = json.loads(Path("/probe/consumer-lock.json").read_text())
    base = json.loads((root / "runtime-manifest.json").read_text())
    base_names = {canonicalize_name(p["name"]) for p in base["packages"]}
    assert not base_names.intersection(
        canonicalize_name(p["name"]) for p in lock["packages"]
    ), "consumer overlay may not replace a base distribution"
    for package in lock["packages"]:
        assert metadata.version(package["name"]) == package["version"]
        assert not canonicalize_name(package["name"]).startswith("meridian-storage-")
    # Exercise the exact wheel metadata independently from pip's resolver.
    requirements = []
    for service in lock["services"]:
        dist = metadata.distribution(service["name"])
        assert dist.version == service["version"]
        for value in dist.requires or ():
            requirement = Requirement(value)
            if requirement.marker and not requirement.marker.evaluate({"extra": ""}):
                continue
            installed = metadata.version(requirement.name)
            assert installed in requirement.specifier
            requirements.append({"requirement": value, "installed": installed})
    catalogs = {}
    for name in lock["requiredCatalogs"]:
        entries = list(
            metadata.entry_points(group="meridian_storage.catalogs", name=name)
        )
        assert len(entries) == 1
        entries[0].load()
        catalogs[name] = entries[0].value
    modules, schemas = [], {}
    for service in lock["services"]:
        package = importlib.import_module(service["importRoot"])
        for item in pkgutil.walk_packages(package.__path__, package.__name__ + "."):
            if item.name.endswith(".__main__"):
                continue
            module = importlib.import_module(item.name)
            assert str(Path(module.__file__).resolve()).startswith("/usr/local/")
            modules.append(item.name)
            for _, value in inspect.getmembers(module, inspect.isclass):
                if value.__module__ != item.name or not issubclass(value, BaseModel):
                    continue
                raw = json.dumps(value.model_json_schema(), sort_keys=True).encode()
                schemas[f"{item.name}.{value.__name__}"] = hashlib.sha256(
                    raw
                ).hexdigest()
    from meridian_storage.adapters.postgresql import PostgreSQLSchemaRepository
    from meridian_storage.semantics import SchemaAPI, SchemaDocument
    from meridian_storage.plugins.observability import Observability
    from meridian_storage.context import OperationContext
    from datetime import UTC, datetime, timedelta
    from contextlib import contextmanager

    @contextmanager
    def no_connection():
        raise AssertionError("offline packaging must not connect to a database")
        yield

    repository = PostgreSQLSchemaRepository(
        connection_factory=no_connection,
        physical_namespace="packaging_probe",
        context=OperationContext(
            tenant="probe",
            principal_ref="probe",
            deadline=datetime.now(UTC) + timedelta(seconds=5),
        ),
    )
    assert isinstance(SchemaAPI(repository), SchemaAPI)
    document = SchemaDocument.from_definition(
        catalog="structured",
        namespace="probe",
        name="schema",
        version="1.0.0",
        definition={
            "semanticKind": "relational",
            "fields": [{"name": "id", "logicalType": "string", "nullable": False}],
            "identity": ["id"],
        },
    )
    assert document.fingerprint != document.to_core_definition().fingerprint
    assert callable(Observability)
    modules.extend(
        [
            "meridian_storage.adapters.postgresql",
            "meridian_storage.semantics",
            "meridian_storage.plugins.observability",
        ]
    )
    schemas["schemaDocumentFingerprint"] = document.fingerprint
    schemas["coreSchemaDefinitionFingerprint"] = (
        document.to_core_definition().fingerprint
    )
    print(
        json.dumps(
            {
                "integrity": integrity,
                "uid": os.getuid(),
                "readOnlyRoot": True,
                "basePackagesUnchanged": len(base["packages"]),
                "catalogs": catalogs,
                "services": lock["services"],
                "requirements": requirements,
                "importedModules": sorted(modules),
                "pydanticSchemas": schemas,
                "packages": lock["packages"],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
