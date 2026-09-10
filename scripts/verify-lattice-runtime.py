"""Validate rendered metadata with installed releases, without a backend or runtime startup."""
import importlib.metadata
import json
from pathlib import Path
import sys

from lattice_model_configuration.schema import AuthoringSchemaProvider
from lattice_generation.schema import GenerationSchemaProvider
from meridian_storage.evidence.schemas import EvidenceSchemaProvider
from meridian_storage.plugins.config_artifact.schemas import ConfigArtifactSchemaProvider
from meridian_storage.runtime.config import load_runtime_config
from meridian_storage.registry.registry import build_registry
from meridian_storage.errors import CompatibilityError

bundles = [provider().load() for provider in (
    AuthoringSchemaProvider, GenerationSchemaProvider,
    EvidenceSchemaProvider, ConfigArtifactSchemaProvider,
)]
by_id = {bundle.provider_id: bundle for bundle in bundles}
catalogs = {
    entry.name: entry.load()().manifest()
    for entry in importlib.metadata.entry_points(group="meridian_storage.catalogs")
}
reports = []
for path in sorted(Path(sys.argv[1]).glob("lattice-*.json")):
    config = load_runtime_config(path)
    selected = [by_id[pin.id] for pin in config.schemas.providers]
    for pin in config.schemas.providers:
        assert by_id[pin.id].fingerprint == pin.required_fingerprint, pin.id
    for catalog in config.catalogs.providers:
        assert catalogs[catalog.name].fingerprint == catalog.required_fingerprint, catalog.name
    available = {resource.ref: (resource, bundle.provider_id) for bundle in selected for resource in bundle.resources}
    refs = {pin.ref for pin in config.resources.pins}
    for pin in config.resources.pins:
        resource, provider_id = available[pin.ref]
        assert provider_id == pin.provider_id
        assert resource.fingerprint == pin.required_fingerprint
        assert resource.fingerprint != by_id[provider_id].fingerprint
        assert set(resource.related_resources).issubset(refs), str(resource.ref)
        placements = [placement for placement in config.placements if placement.selector.matches(pin.ref, resource.labels)]
        assert len(placements) == 1
        assert placements[0].binding_id == ("object" if pin.ref.catalog == "object" else "structured")
    # The real Core Registry rejects an altered ResourceDefinition pin before it can use a backend.
    raw = json.loads(path.read_text())
    raw["resources"]["pins"][0]["requiredFingerprint"] = "sha256:" + "f" * 64
    # A tmpfs path is supplied by the local verification command.
    negative = Path("/tmp/drift.json")
    negative.write_text(json.dumps(raw))
    try:
        build_registry(selected, load_runtime_config(negative),
                       {pin.name: catalogs[pin.name] for pin in config.catalogs.providers},
                       {}, {}, {}, revision=1)
    except CompatibilityError as error:
        assert "fingerprint mismatch" in str(error)
    else:
        raise AssertionError("Core accepted ResourceDefinition drift")
    reports.append({"domain": path.stem, "resources": len(refs),
                    "providerBundles": len(selected), "catalogs": len(config.catalogs.providers),
                    "resourceDriftRejectedByCore": True, "namespaceLocalReferences": True})
assert len(reports) == 2
print(json.dumps({"scope": "released-package configuration, bundle, Resource, related-reference and placement validation",
                  "runtimeStartup": "not-run", "backendOperations": "not-run", "reports": reports}, indent=2))
