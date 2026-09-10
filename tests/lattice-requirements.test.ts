import { describe, expect, it } from "vitest";
import { resourceDefinitionFingerprint } from "@zephytiju/meridian-storage-constructs";
import {
  composeDomainRequirements,
  validateDomainRequirements,
} from "../src/domain-requirements.js";
import type {
  DomainMeridianRequirements,
  SharedResourceStoreRequirements,
} from "../src/types.js";
import {
  latticeDomains,
  latticeSharedStore,
  observation,
} from "./lattice-fixture.js";
import { domainRequirements } from "./domain-fixture.js";

const hash = `sha256:${"f".repeat(64)}` as const;

describe("released Lattice namespace ownership and shared ResourceStores", () => {
  it("preserves released bundle and ResourceDefinition pins without renaming or weakening requirements", () => {
    for (const provider of observation.providers) {
      expect(provider.providerFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
      for (const resource of provider.resources) {
        expect(resource.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(resource.fingerprint).not.toBe(provider.providerFingerprint);
      }
    }
    const domains = latticeDomains();
    const store = latticeSharedStore();
    expect(() =>
      validateDomainRequirements([...domains, domainRequirements()], [store]),
    ).not.toThrow();
    expect(domains.map((domain) => domain.resourceNamespace)).toEqual([
      "lattice-authoring",
      "lattice-generation",
    ]);
    for (const domain of domains) {
      const composition = composeDomainRequirements(domain, [store]);
      expect(composition.resources).toEqual([
        ...domain.resources,
        ...store.resources,
      ]);
      expect(composition.schemaProviders).toEqual([
        ...domain.schemaProviders,
        store.provider,
      ]);
      expect(
        composition.resources.find(
          ({ selector }) => selector.catalog === "object",
        )!.operations[0]!.guarantees,
      ).toContain("object.digest-verification");
      for (const resource of composition.resources)
        expect(resourceDefinitionFingerprint(resource.schemas[0]!)).not.toBe(
          store.provider.requiredFingerprint,
        );
    }
  });

  it.each([
    [
      "missing namespace proof",
      (d: DomainMeridianRequirements) => ({
        ...d,
        namespaceOwnership: undefined,
      }),
    ],
    [
      "different namespace",
      (d: DomainMeridianRequirements) => ({
        ...d,
        namespaceOwnership: {
          ...d.namespaceOwnership!,
          namespace: "lattice.other",
        },
      }),
    ],
    [
      "different release",
      (d: DomainMeridianRequirements) => ({
        ...d,
        namespaceOwnership: {
          ...d.namespaceOwnership!,
          provider: { ...d.namespaceOwnership!.provider, version: "0.4.0" },
        },
      }),
    ],
    [
      "different bundle",
      (d: DomainMeridianRequirements) => ({
        ...d,
        namespaceOwnership: {
          ...d.namespaceOwnership!,
          provider: {
            ...d.namespaceOwnership!.provider,
            requiredFingerprint: hash,
          },
        },
      }),
    ],
    [
      "foreign logical owner",
      (d: DomainMeridianRequirements) => ({
        ...d,
        ownerPackage: "juntai.platform.domain.prism",
      }),
    ],
    [
      "reserved namespace",
      (d: DomainMeridianRequirements) => ({
        ...d,
        resourceNamespace: "resources",
        namespaceOwnership: {
          ...d.namespaceOwnership!,
          namespace: "resources",
        },
      }),
    ],
    [
      "physical ownership data",
      (d: DomainMeridianRequirements) => ({
        ...d,
        namespaceOwnership: { ...d.namespaceOwnership!, endpoint: "private" },
      }),
    ],
    [
      "duplicate dependency",
      (d: DomainMeridianRequirements) => ({
        ...d,
        resourceStoreDependencies: [
          ...d.resourceStoreDependencies!,
          ...d.resourceStoreDependencies!,
        ],
      }),
    ],
    [
      "missing Resource pins",
      (d: DomainMeridianRequirements) => ({
        ...d,
        resourceStoreDependencies: [
          { ...d.resourceStoreDependencies![0]!, resourceFingerprints: [] },
        ],
      }),
    ],
    [
      "provider drift",
      (d: DomainMeridianRequirements) => ({
        ...d,
        resourceStoreDependencies: [
          {
            ...d.resourceStoreDependencies![0]!,
            provider: {
              ...d.resourceStoreDependencies![0]!.provider,
              requiredFingerprint: hash,
            },
          },
        ],
      }),
    ],
    [
      "Resource drift",
      (d: DomainMeridianRequirements) => ({
        ...d,
        resourceStoreDependencies: [
          {
            ...d.resourceStoreDependencies![0]!,
            resourceFingerprints:
              d.resourceStoreDependencies![0]!.resourceFingerprints.map(
                (pin) => ({ ...pin, requiredFingerprint: hash }),
              ),
          },
        ],
      }),
    ],
    [
      "duplicate Resource pin",
      (d: DomainMeridianRequirements) => ({
        ...d,
        resourceStoreDependencies: [
          {
            ...d.resourceStoreDependencies![0]!,
            resourceFingerprints: [
              ...d.resourceStoreDependencies![0]!.resourceFingerprints,
              d.resourceStoreDependencies![0]!.resourceFingerprints[0]!,
            ],
          },
        ],
      }),
    ],
    [
      "physical dependency data",
      (d: DomainMeridianRequirements) => ({
        ...d,
        resourceStoreDependencies: [
          { ...d.resourceStoreDependencies![0]!, physicalNamespace: "private" },
        ],
      }),
    ],
    [
      "domain-owned shared provider",
      (d: DomainMeridianRequirements) => ({
        ...d,
        schemaProviders: [...d.schemaProviders, latticeSharedStore().provider],
      }),
    ],
  ])("fails closed on %s", (_label, mutate) => {
    expect(() =>
      validateDomainRequirements(
        [mutate(latticeDomains()[0]!) as DomainMeridianRequirements],
        [latticeSharedStore()],
      ),
    ).toThrow();
  });

  it("rejects missing selection, namespace owner collision and release drift before resources register", () => {
    const domain = latticeDomains()[0]!;
    expect(() => validateDomainRequirements([domain])).toThrow(
      "missing shared ResourceStore",
    );
    const changedProvider = {
      ...domain.schemaProviders[0]!,
      requiredFingerprint: hash,
    };
    expect(() =>
      validateDomainRequirements(
        [
          domain,
          {
            ...domain,
            id: "collision",
            schemaProviders: [changedProvider],
            namespaceOwnership: {
              namespace: domain.resourceNamespace,
              provider: changedProvider,
            },
          },
        ],
        [latticeSharedStore()],
      ),
    ).toThrow("conflicting owners or releases");
    expect(() =>
      validateDomainRequirements(
        [domain, { ...domain, id: "duplicate-resources" }],
        [latticeSharedStore()],
      ),
    ).toThrow("duplicate domain Meridian resource");
  });

  it.each([
    ["duplicate stores", (s: SharedResourceStoreRequirements) => [s, s]],
    [
      "overlapping store ownership",
      (s: SharedResourceStoreRequirements) => [s, { ...s, id: "other" }],
    ],
    [
      "missing object Resource",
      (s: SharedResourceStoreRequirements) => [
        {
          ...s,
          resources: s.resources.filter(
            ({ selector }) => selector.catalog !== "object",
          ),
        },
      ],
    ],
    [
      "unknown plugin",
      (s: SharedResourceStoreRequirements) => [{ ...s, kind: "anything" }],
    ],
    [
      "untyped physical data",
      (s: SharedResourceStoreRequirements) => [{ ...s, engines: [] }],
    ],
    [
      "provider hash substituted for Resource",
      (s: SharedResourceStoreRequirements) => [
        {
          ...s,
          resources: s.resources.map((r) => ({
            ...r,
            schemas: [
              {
                ...r.schemas[0]!,
                resourceFingerprint: s.provider.requiredFingerprint,
              },
            ],
          })),
        },
      ],
    ],
    [
      "floating release",
      (s: SharedResourceStoreRequirements) => [
        { ...s, provider: { ...s.provider, version: "latest" } },
      ],
    ],
    [
      "unsupported selector",
      (s: SharedResourceStoreRequirements) => [
        {
          ...s,
          resources: s.resources.map((r) => ({
            ...r,
            selector: { ...r.selector, namespace: "foreign" },
          })),
        },
      ],
    ],
  ])("rejects %s in Foundations selections", (_label, mutate) => {
    expect(() =>
      validateDomainRequirements(
        latticeDomains(),
        mutate(latticeSharedStore()) as SharedResourceStoreRequirements[],
      ),
    ).toThrow();
  });
});
