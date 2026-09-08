"""Platform-owned connections for the explicitly selected durable registry profile.

Construction does not connect, migrate, publish or refresh Core's global registry.
SchemaAPI reads use the current verified OperationContext, with no tenant cache.
"""

from contextlib import contextmanager
import math
import os
from pathlib import Path
import stat

import psycopg
from psycopg.conninfo import conninfo_to_dict

from meridian_storage import Meridian
from meridian_storage.adapters.postgresql import (
    PostgreSQLSchemaRepository,
    PostgreSQLSettings,
)
from meridian_storage.context import current_context
from meridian_storage.runtime import load_runtime_config_from_environment
from meridian_storage.spi.adapters import SecretValue
from meridian_storage.semantics import SchemaAPI


class ProjectedFiles:
    """Read a bounded regular file through Kubernetes' atomic projection symlinks."""

    def resolve(self, reference):
        if reference.provider != "file" or not Path(reference.reference).is_absolute():
            raise ValueError("PROJECTED_FILE_REFERENCE_REQUIRED")
        try:
            descriptor = os.open(reference.reference, os.O_RDONLY | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise ValueError("PROJECTED_FILE_REQUIRED")
                value = stream.read(1024 * 1024 + 1)
            if not value or len(value) > 1024 * 1024:
                raise ValueError("PROJECTED_FILE_LIMIT")
            return SecretValue(value)
        except OSError:
            raise ValueError("PROJECTED_FILE_UNAVAILABLE") from None


def create_bindings(environment=None):
    environment = os.environ if environment is None else environment
    config = load_runtime_config_from_environment(environment)
    resolver = ProjectedFiles()
    meridian = Meridian(config, secret_resolver=resolver)
    binding_id = environment.get("MERIDIAN_METADATA_BINDING")
    if not binding_id:
        return meridian, None
    selected = [binding for binding in config.bindings if binding.id == binding_id]
    if len(selected) != 1:
        raise ValueError("METADATA_BINDING_REQUIRED")
    binding = selected[0]
    settings = PostgreSQLSettings.from_binding(binding)
    if not any(
        layout.profile == "metadata-registry" for layout in settings.resources.values()
    ):
        raise ValueError("METADATA_REGISTRY_LAYOUT_REQUIRED")
    if not binding.endpoint:
        raise ValueError("METADATA_ENDPOINT_REQUIRED")
    endpoint = conninfo_to_dict(binding.endpoint)
    if "user" in endpoint or "password" in endpoint:
        raise ValueError("METADATA_ENDPOINT_CREDENTIALS_FORBIDDEN")
    if binding.tls.mode not in {"server", "mutual"}:
        raise ValueError("METADATA_AUTHENTICATED_TLS_REQUIRED")

    def file_path(reference):
        if reference is None or reference.provider != "file":
            raise ValueError("METADATA_PROJECTED_FILE_REQUIRED")
        path = Path(reference.reference)
        if not path.is_absolute():
            raise ValueError("METADATA_PROJECTED_FILE_REQUIRED")
        return str(path)

    ca = file_path(binding.tls.ca_ref)
    certificate = (
        file_path(binding.tls.client_certificate_ref)
        if binding.tls.mode == "mutual"
        else None
    )
    if binding.tls.server_name and endpoint.get("host") != binding.tls.server_name:
        raise ValueError("METADATA_TLS_SERVER_NAME_MISMATCH")

    def schema_api():
        context = current_context()
        if not context.tenant or not context.principal_ref or context.deadline is None:
            raise ValueError("METADATA_VERIFIED_CONTEXT_REQUIRED")

        @contextmanager
        def connection():
            remaining = context.remaining_seconds()
            if remaining <= 0:
                raise ValueError("METADATA_DEADLINE_EXCEEDED")
            identity = resolver.resolve(binding.identity_ref).reveal().decode()
            secret = resolver.resolve(binding.secret_ref).reveal().decode()
            options = {
                **endpoint,
                "user": identity,
                "password": secret,
                "sslmode": "verify-full",
                "sslrootcert": ca,
                "connect_timeout": max(1, math.ceil(min(remaining, 5))),
                "application_name": settings.application_name,
            }
            if certificate:
                options.update(sslcert=certificate, sslkey=certificate)
            with psycopg.connect(**options) as value:
                yield value

        return SchemaAPI(
            PostgreSQLSchemaRepository(
                connection_factory=connection,
                physical_namespace=settings.physical_schema,
                context=context,
                operation_timeout_ms=min(binding.client.operation_timeout_ms, 30000),
            )
        )

    return meridian, schema_api
