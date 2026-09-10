import { describe, expect, it } from "vitest";
import {
  peerOwnedReferenceEngines,
  peerRuntimeRequirements,
} from "../src/peer-runtimes.js";
import { validateFoundationsInputs } from "../src/validation.js";
import { structuredEngine } from "./helpers.js";
import { ownedEngines, peerInputs } from "./peer-fixture.js";
import { latticeSharedStore } from "./lattice-fixture.js";

describe("released peer runtime contracts", () => {
  it("selects exact per-resource pins and native catalog ABI", () => {
    const metadata = peerRuntimeRequirements("application-metadata");
    const blueprint = peerRuntimeRequirements("blueprint");
    expect(metadata.resources).toHaveLength(9);
    expect(blueprint.resources).toHaveLength(7);
    expect(metadata.compatibilityPins["meridian-storage-postgresql"]).toBe(
      "1.0.0",
    );
    expect(blueprint.compatibilityPins["meridian-storage-postgresql"]).toBe(
      "2.4.0",
    );
    expect(
      blueprint.resources
        .flatMap((r) => r.operations)
        .some(
          (o) =>
            o.contract === "meridian.structured.put" && o.version === "2.0.0",
        ),
    ).toBe(true);
    expect(blueprint.catalogs.map((c) => c.name)).toContain("evidence");
    expect(
      peerRuntimeRequirements("blueprint", true).catalogs.map((c) => c.name),
    ).toEqual(["structured", "object"]);
    expect(metadata.resources[0]!.schemas[0]!.resourceFingerprint).not.toBe(
      metadata.schemaProviders[0]!.requiredFingerprint,
    );
  });
  it("preserves physical pins, scope and object selection while constructing exact read proofs", () => {
    const engines = ownedEngines();
    const before = JSON.stringify(engines);
    const result = peerOwnedReferenceEngines(
      "blueprint",
      latticeSharedStore(),
      engines,
    );
    expect(JSON.stringify(engines)).toBe(before);
    expect(result[0]!.requiredPhysicalFingerprint).toBe(
      engines[0]!.requiredPhysicalFingerprint,
    );
    expect(result[0]!.settings!.scopeKeys).toEqual(["application", "tenant"]);
    expect(result[1]).toBe(engines[1]);
    expect(result[0]!.settings!.readCompatibility).toMatchObject({
      formatVersion: "meridian.postgresql.read-compatibility.v1",
      resources: expect.arrayContaining([
        expect.objectContaining({
          storedResource: expect.any(Object),
          readerResource: expect.any(Object),
        }),
      ]),
    });
    expect(
      peerOwnedReferenceEngines(
        "application-metadata",
        latticeSharedStore(),
        ownedEngines(false),
      )[0]!.settings!.readCompatibility,
    ).toBeUndefined();
  });
  it.each(["resourceFingerprint", "schemaFingerprint", "profile"])(
    "rejects physical layout drift: %s",
    (field) => {
      const engines = structuredClone(ownedEngines());
      const layouts = engines[0]!.settings!.resources as Record<
        string,
        unknown
      >[];
      layouts[0]![field] = "wrong";
      expect(() =>
        peerOwnedReferenceEngines("blueprint", latticeSharedStore(), engines),
      ).toThrow(/layout\/schema fingerprint/);
    },
  );
  it("rejects missing physical pins, wrong bindings and tenant-only layouts", () => {
    expect(() =>
      peerOwnedReferenceEngines(
        "blueprint",
        latticeSharedStore(),
        ownedEngines().slice(1),
      ),
    ).toThrow(/physical pins/);
    const engines = structuredClone(ownedEngines());
    expect(() =>
      peerOwnedReferenceEngines("blueprint", latticeSharedStore(), [
        { ...engines[0]!, requiredPhysicalFingerprint: "sha256:wrong" },
        engines[1]!,
      ]),
    ).toThrow(/physical pins/);
    const settings = engines[0]!.settings! as Record<string, unknown>;
    settings.scopeKeys = ["tenant"];
    expect(() =>
      peerOwnedReferenceEngines("blueprint", latticeSharedStore(), engines),
    ).toThrow(/application and tenant scope/);
    settings.formatVersion = "wrong";
    expect(() =>
      peerOwnedReferenceEngines("blueprint", latticeSharedStore(), engines),
    ).toThrow(/stored layout/);
  });
  it("rejects duplicate/missing layouts, pre-existing proofs and provider drift", () => {
    const engines = structuredClone(ownedEngines());
    const settings = engines[0]!.settings! as Record<string, unknown>;
    const layouts = settings.resources as Record<string, unknown>[];
    settings.resources = [...layouts, layouts[0]];
    expect(() =>
      peerOwnedReferenceEngines("blueprint", latticeSharedStore(), engines),
    ).toThrow(/duplicate/);
    settings.resources = layouts.slice(1);
    expect(() =>
      peerOwnedReferenceEngines("blueprint", latticeSharedStore(), engines),
    ).toThrow(/layout/);
    settings.readCompatibility = {};
    expect(() =>
      peerOwnedReferenceEngines("blueprint", latticeSharedStore(), engines),
    ).toThrow(/composes/);
    const store = latticeSharedStore();
    expect(() =>
      peerOwnedReferenceEngines(
        "blueprint",
        { ...store, provider: { ...store.provider, version: "1.1.2" } },
        ownedEngines(),
      ),
    ).toThrow(/exact released producer/);
    expect(() =>
      peerOwnedReferenceEngines(
        "blueprint",
        { ...store, resources: store.resources.slice(1) },
        ownedEngines(),
      ),
    ).toThrow(/Resource fingerprints/);
  });
  it("validates peer credential projections and generated-store selection before deployment", () => {
    expect(() => validateFoundationsInputs(peerInputs())).not.toThrow();
    const input = peerInputs();
    const selection = input.meridian.peerRuntimeSelections!.blueprint!;
    const validate = (patch: object) =>
      validateFoundationsInputs({
        ...input,
        meridian: {
          ...input.meridian,
          peerRuntimeSelections: { blueprint: { ...selection, ...patch } },
        },
      });
    expect(() => validate({ runtimeReferences: [] })).toThrow(
      /own runtimeReferences/,
    );
    expect(() => validate({ engines: [structuredEngine(true)] })).toThrow(
      /exactly structured and object/,
    );
    expect(() => validate({ extra: true })).toThrow(/unknown/);
    expect(() =>
      validate({
        ownedReferences: {
          ...selection.ownedReferences,
          storeId: "undeclared",
        },
      }),
    ).toThrow(/undeclared/);
    expect(() =>
      validate({
        ownedReferences: {
          ...selection.ownedReferences,
          runtimeReferences: selection.runtimeReferences,
        },
      }),
    ).toThrow(/collide/);
    expect(() =>
      validate({
        ownedReferences: { ...selection.ownedReferences, extra: true },
      }),
    ).toThrow(/unknown/);
    expect(() =>
      validateFoundationsInputs({
        ...input,
        blueprint: {
          ...input.blueprint,
          ownedReferenceRuntime: {
            configuration: {
              name: "duplicate",
              mountPath: "/etc/duplicate",
              items: { "meridian-config.v1.json": "config" },
            },
          },
        },
      }),
    ).toThrow(/both generated and external/);
    expect(() =>
      validateFoundationsInputs({
        ...input,
        meridian: {
          ...input.meridian,
          peerRuntimeSelections: { other: selection } as never,
        },
      }),
    ).toThrow(/unknown peer/);
  });
});
