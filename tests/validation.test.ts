import { describe, expect, it } from "vitest";
import { validateFoundationsInputs } from "../src/validation.js";
import { foundationsInputs } from "./helpers.js";

describe("Foundations input validation", () => {
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
