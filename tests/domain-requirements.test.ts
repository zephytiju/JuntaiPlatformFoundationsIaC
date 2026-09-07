import { describe, expect, it } from "vitest";
import type { DomainMeridianRequirements } from "../src/types.js";
import { validateDomainRequirements } from "../src/domain-requirements.js";

import { domainRequirements } from "./domain-fixture.js";

describe("domain logical-resource boundary", () => {
  it("accepts separate immutable domain requirements with colocated structured and audit resources", () => {
    expect(() => validateDomainRequirements()).not.toThrow();
    expect(() =>
      validateDomainRequirements([
        domainRequirements(),
        domainRequirements("prism-build", "prism.build"),
      ]),
    ).not.toThrow();
  });

  it.each([
    ["duplicate ID", (d: DomainMeridianRequirements) => [d, d]],
    [
      "invalid ID",
      (d: DomainMeridianRequirements) => [{ ...d, id: "../escape" }],
    ],
    [
      "foreign package",
      (d: DomainMeridianRequirements) => [
        { ...d, ownerPackage: "juntai.platform.substrate" },
      ],
    ],
    [
      "foreign namespace",
      (d: DomainMeridianRequirements) => [
        { ...d, resourceNamespace: "platform.account" },
      ],
    ],
    [
      "physical selection",
      (d: DomainMeridianRequirements) => [{ ...d, engines: [] }],
    ],
    [
      "empty resources",
      (d: DomainMeridianRequirements) => [{ ...d, resources: [] }],
    ],
    [
      "missing provider",
      (d: DomainMeridianRequirements) => [{ ...d, schemaProviders: [] }],
    ],
    [
      "floating provider",
      (d: DomainMeridianRequirements) => [
        {
          ...d,
          schemaProviders: [{ ...d.schemaProviders[0]!, version: "latest" }],
        },
      ],
    ],
    [
      "duplicate provider",
      (d: DomainMeridianRequirements) => [
        { ...d, schemaProviders: [...d.schemaProviders, ...d.schemaProviders] },
      ],
    ],
    [
      "foreign resource",
      (d: DomainMeridianRequirements) => [
        {
          ...d,
          resources: [
            {
              ...d.resources[0]!,
              selector: {
                ...d.resources[0]!.selector,
                namespace: "platform.account",
              },
            },
          ],
        },
      ],
    ],
    [
      "duplicate resource",
      (d: DomainMeridianRequirements) => [
        { ...d, resources: [...d.resources, ...d.resources] },
      ],
    ],
    [
      "missing schema",
      (d: DomainMeridianRequirements) => [
        { ...d, resources: [{ ...d.resources[0]!, schemas: [] }] },
      ],
    ],
    [
      "schema fingerprint mismatch",
      (d: DomainMeridianRequirements) => [
        {
          ...d,
          resources: [
            {
              ...d.resources[0]!,
              schemas: [
                {
                  ...d.resources[0]!.schemas[0]!,
                  fingerprint: `sha256:${"b".repeat(64)}`,
                },
              ],
            },
          ],
        },
      ],
    ],
  ])("rejects %s before provider construction", (_label, mutate) => {
    expect(() =>
      validateDomainRequirements(
        mutate(domainRequirements()) as readonly DomainMeridianRequirements[],
      ),
    ).toThrow();
  });
});
