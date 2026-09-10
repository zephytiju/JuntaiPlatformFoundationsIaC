"""Export installed public release contracts; never import a domain checkout."""
import importlib.metadata
import json
import sys

from lattice_model_configuration.schema import AuthoringSchemaProvider
from lattice_generation.schema import GenerationSchemaProvider
from meridian_storage.plugins.config_artifact.schemas import ConfigArtifactSchemaProvider


def describe(package, provider):
    bundle = provider.load()
    return {
        "package": package,
        "version": importlib.metadata.version(package),
        "providerId": bundle.provider_id,
        "providerContract": bundle.provider_contract_version,
        "providerVersion": bundle.provider_version,
        "providerFingerprint": bundle.fingerprint,
        **({"bundle": bundle.to_dict()} if "--full" in sys.argv else {}),
        "resources": [
            {
                "selector": resource.ref.to_dict(),
                "fingerprint": resource.fingerprint,
                **({"definition": resource.to_dict()} if "--full" in sys.argv else {}),
                "operations": [
                    {
                        "contract": requirement.operation_contract,
                        "version": requirement.operation_version,
                        "guarantees": sorted(requirement.guarantees),
                        "limits": dict(requirement.minimum_limits),
                    }
                    for requirement in resource.requirements
                ],
            }
            for resource in bundle.resources
        ],
    }


print(json.dumps({
    "format": "juntai.lattice/released-schema-provider-observation/v1",
    "providers": [
        describe("lattice-model-configuration-service", AuthoringSchemaProvider()),
        describe("lattice-runtime-generation-service", GenerationSchemaProvider()),
        describe("meridian-plugin-config-artifact", ConfigArtifactSchemaProvider()),
    ],
    "catalogs": [
        {"name": entry.name, "fingerprint": entry.load()().manifest().fingerprint}
        for entry in sorted(importlib.metadata.entry_points(group="meridian_storage.catalogs"), key=lambda item: item.name)
        if entry.name in ("structured", "evidence", "object")
    ],
}, indent=2, sort_keys=True))
