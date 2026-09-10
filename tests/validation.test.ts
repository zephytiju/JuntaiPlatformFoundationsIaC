import { describe, expect, it } from "vitest";
import {
  validateDomainRuntimeSelections,
  validateFoundationsInputs,
} from "../src/validation.js";
import type { DomainRuntimeSelection } from "../src/types.js";
import { domainRequirements } from "./domain-fixture.js";
import { durableRuntimeDistributionFixture } from "./runtime-distribution-fixture.js";
import { foundationsInputs } from "./helpers.js";

describe("Foundations input validation", () => {
  it("rejects duplicate or disabled destination service grants", () => {
    const base = foundationsInputs();
    const grant = {
      service: "blueprint" as const,
      namespace: "prism",
      workloadName: "prism-component",
    };
    expect(() =>
      validateFoundationsInputs({ ...base, serviceConsumers: [grant, grant] }),
    ).toThrow("unique exact");
    expect(() =>
      validateFoundationsInputs({
        ...base,
        blueprint: { ...base.blueprint, enabled: false },
        serviceConsumers: [grant],
      }),
    ).toThrow("disabled Foundation service");
  });
  it("requires exact opaque Secret projections", () => {
    const base = foundationsInputs();
    expect(() =>
      validateFoundationsInputs({
        ...base,
        casdoor: {
          ...base.casdoor,
          configuration: { ...base.casdoor.configuration, items: {} },
        },
      }),
    ).toThrow(/app.conf/);
    expect(() =>
      validateFoundationsInputs({
        ...base,
        blueprint: {
          ...base.blueprint,
          cursorHmac: { ...base.blueprint.cursorHmac, mountPath: "relative" },
        },
      }),
    ).toThrow(/absolute normalized/);
    expect(() =>
      validateFoundationsInputs({
        ...base,
        blueprint: {
          ...base.blueprint,
          policyReaderClientSecret: {
            ...base.blueprint.policyReaderClientSecret,
            name: "INVALID_NAME",
          },
        },
      }),
    ).toThrow(/DNS label/);
    expect(() =>
      validateFoundationsInputs({
        ...base,
        blueprint: { ...base.blueprint, casdoorIssuer: "http://external.test" },
      }),
    ).toThrow(/HTTPS or cluster-local HTTP/);
  });

  it("requires HTTPS redirects, valid bootstrap refs, and Engine selections", () => {
    const base = foundationsInputs();
    expect(() =>
      validateFoundationsInputs({
        ...base,
        casdoor: { ...base.casdoor, consoleRedirectUri: "http://console.test" },
      }),
    ).toThrow(/must use HTTPS/);
    expect(() =>
      validateFoundationsInputs({
        ...base,
        casdoor: {
          ...base.casdoor,
          bootstrapCredential: { name: "INVALID", key: "bad key" },
        },
      }),
    ).toThrow(/opaque Secret key reference/);
    expect(() =>
      validateFoundationsInputs({
        ...base,
        meridian: { engines: [] },
      }),
    ).toThrow(/requires deployment-selected Meridian Engines/);
    expect(() =>
      validateFoundationsInputs({
        ...base,
        meridian: { engines: base.meridian.engines },
      }),
    ).toThrow(/file reference must be projected/);
    expect(() =>
      validateFoundationsInputs({
        ...base,
        meridian: {
          ...base.meridian,
          peerRuntimeSelections: undefined,
          runtimeReferences: [
            {
              kind: "secret",
              name: "colliding-meridian-runtime",
              mountPath: base.blueprint.cursorHmac.mountPath,
              items: {
                "runtime-identity": "identity/hmac-key",
                "runtime-credential": "credential/client-secret",
              },
            },
          ],
        },
      }),
    ).toThrow(/Blueprint mount paths must be unique/);
  });

  it("rejects ambiguous Application Metadata workload authority", () => {
    const base = foundationsInputs();
    expect(() =>
      validateFoundationsInputs({
        ...base,
        applicationMetadata: {
          ...base.applicationMetadata,
          workloadBindings: [
            {
              namespace: "juntai-platform",
              serviceAccount: "release-controller",
              tenantId: "tenant-a",
              workloadId: "release-controller-a",
            },
            {
              namespace: "juntai-platform",
              serviceAccount: "release-controller",
              tenantId: "tenant-b",
              workloadId: "release-controller-b",
            },
          ],
        },
      }),
    ).toThrow(/must be unique/);
  });
});

describe("domain runtime authority and credential isolation", () => {
  const base = foundationsInputs().meridian;
  const selection: DomainRuntimeSelection = {
    distribution: durableRuntimeDistributionFixture().selection,
    engines: base.engines.filter(({ bindingId }) => bindingId === "structured"),
    runtimeReferences: base.runtimeReferences!,
  };
  const validate = (selected: DomainRuntimeSelection) =>
    validateDomainRuntimeSelections({
      ...base,
      domains: [domainRequirements()],
      domainRuntimeSelections: { "prism-composition": selected },
    });

  it("accepts an explicit physical selection with its own projections", () => {
    expect(() => validate(selection)).not.toThrow();
  });

  it("does not borrow global credentials or accept a ConfigMap as a credential", () => {
    expect(() => validate({ ...selection, runtimeReferences: [] })).toThrow(
      "its own runtimeReferences",
    );
    expect(() =>
      validate({
        ...selection,
        runtimeReferences: selection.runtimeReferences.map((reference) => ({
          ...reference,
          kind: "configMap",
        })),
      }),
    ).toThrow("its own runtimeReferences");
  });

  it("rejects an undeclared domain and unrecognized physical settings", () => {
    expect(() =>
      validateDomainRuntimeSelections({
        ...base,
        domainRuntimeSelections: { undeclared: selection },
      }),
    ).toThrow("undeclared domain");
    expect(() =>
      validate({ ...selection, typo: true } as DomainRuntimeSelection),
    ).toThrow("unknown runtime selection fields");
  });

  it("requires unambiguous business and metadata binding identities", () => {
    expect(() => validate({ ...selection, engines: [] })).toThrow(
      "including structured",
    );
    expect(() =>
      validate({
        ...selection,
        engines: [...selection.engines, ...selection.engines],
      }),
    ).toThrow("unique Engines");
    expect(() =>
      validate({ ...selection, metadataBindingId: "not-selected" }),
    ).toThrow("metadata binding is not selected");
  });

  it("rejects colliding or traversing projected credential paths", () => {
    expect(() =>
      validate({
        ...selection,
        runtimeReferences: [
          ...selection.runtimeReferences,
          ...selection.runtimeReferences,
        ],
      }),
    ).toThrow("mount paths must be unique");
    expect(() =>
      validate({
        ...selection,
        runtimeReferences: [
          {
            ...selection.runtimeReferences[0]!,
            items: { credential: "../outside" },
          },
        ],
      }),
    ).toThrow("relative paths");
  });
});
