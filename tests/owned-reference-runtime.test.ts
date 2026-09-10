import { describe, expect, it } from "vitest";
import { validateFoundationsInputs } from "../src/validation.js";
import type { OwnedReferenceRuntimeInput } from "../src/types.js";
import { foundationsInputs } from "./helpers.js";

export const ownedInput: OwnedReferenceRuntimeInput = {
  configuration: {
    name: "owned-artifact-runtime",
    mountPath: "/etc/juntai/owned-artifacts",
    items: { "meridian-config.v1.json": "runtime.json" },
  },
  runtimeReferences: [
    {
      kind: "secret",
      name: "owned-artifact-credentials",
      mountPath: "/var/run/juntai/owned-artifacts",
      items: { connection: "connection" },
    },
  ],
};

describe.each(["applicationMetadata", "blueprint"] as const)(
  "%s owned-reference runtime boundary",
  (service) => {
    const validate = (input: OwnedReferenceRuntimeInput) => {
      const base = foundationsInputs();
      return validateFoundationsInputs({
        ...base,
        [service]: { ...base[service], ownedReferenceRuntime: input },
      });
    };
    it("accepts opaque configuration and separate credential projections", () => {
      expect(() => validate(ownedInput)).not.toThrow();
      expect(() =>
        validateFoundationsInputs(foundationsInputs()),
      ).not.toThrow();
    });
    it.each([
      "/etc/juntai",
      service === "blueprint"
        ? "/etc/juntai/meridian"
        : "/etc/juntai/application-metadata",
      service === "blueprint"
        ? "/etc/juntai/meridian/shadow"
        : "/etc/juntai/application-metadata/shadow",
      "/var/run/juntai/runtime",
    ])("rejects shadowing an existing runtime mount: %s", (mountPath) => {
      expect(() =>
        validate({
          ...ownedInput,
          configuration: { ...ownedInput.configuration, mountPath },
        }),
      ).toThrow(/collide/);
    });
    it.each(["/etc//owned", "/etc/./owned", "/etc/owned/../other", "/"])(
      "rejects ambiguous projection paths: %s",
      (mountPath) => {
        expect(() =>
          validate({
            ...ownedInput,
            configuration: { ...ownedInput.configuration, mountPath },
          }),
        ).toThrow(/normalized/);
      },
    );
    it("requires the public runtime configuration key", () => {
      expect(() =>
        validate({
          ...ownedInput,
          configuration: {
            ...ownedInput.configuration,
            items: { "other.json": "runtime.json" },
          },
        }),
      ).toThrow(/meridian-config/);
    });
    it("rejects undeclared runtime overrides", () => {
      expect(() =>
        validate({
          ...ownedInput,
          ownerApplicationId: "app_untrusted",
        } as OwnedReferenceRuntimeInput),
      ).toThrow(/unknown fields/);
      expect(() =>
        validate({
          ...ownedInput,
          configuration: { ...ownedInput.configuration, kind: "secret" },
        } as OwnedReferenceRuntimeInput),
      ).toThrow(/unknown fields/);
    });
    it("rejects inline credentials", () => {
      expect(() =>
        validate({
          ...ownedInput,
          password: "inline",
        } as OwnedReferenceRuntimeInput),
      ).toThrow(/secret material/);
    });
  },
);
