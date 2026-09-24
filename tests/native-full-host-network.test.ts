import { describe, expect, it } from "vitest";
import { compileNativeFullHostNetwork } from "../src/native-full-host-network.js";
import { offlineReaderExposures as exposures } from "./fixtures/full-host-readers.js";

describe("full-host network plan; live enforcement NOT RUN", () => {
  it("preserves original reader artifacts and retains isolated reader lanes", () => {
    const original = exposures();
    const before = JSON.stringify(original);
    const plan = compileNativeFullHostNetwork(original);
    expect(JSON.stringify(original)).toBe(before);
    expect(plan.externalInterfaces).toBe(false);
    expect(plan.credentialForwardingBridges).toBe(false);
    expect(plan.nativeAdmission).toBe(false);
    expect(
      plan.edges.filter((e) => e.target === "nousReader").map((e) => e.role),
    ).toEqual(["nous"]);
    expect(
      plan.edges.filter((e) => e.target === "latticeReader").map((e) => e.role),
    ).toEqual(["lattice"]);
    expect(
      plan.edges.filter((e) => e.target === "casdoor").map((e) => e.role),
    ).toEqual(["nousReader", "latticeReader", "issuerProxy"]);
    expect(
      plan.edges
        .filter((e) => e.target === "casdoorDatabase")
        .map((e) => e.role),
    ).toEqual(["casdoor"]);
  });

  it("denies unknown UIDs, external addresses, UDP, wildcard ports and model egress", () => {
    const plan = compileNativeFullHostNetwork(exposures());
    expect(plan.edges.every((edge) => edge.address === "127.0.0.1")).toBe(true);
    expect(plan.edges.some((edge) => edge.role === "model")).toBe(false);
    expect(plan.nft.match(/policy drop/g)).toHaveLength(2);
    expect(plan.nft).not.toMatch(/udp|0\.0\.0\.0|::|dport \{|skuid 0 /);
    for (const edge of plan.edges)
      expect(plan.nft).toContain(
        `meta skuid ${edge.uid} ip daddr 127.0.0.1 tcp dport ${edge.port} accept`,
      );
  });

  it.each([
    "proxyUid",
    "consumerUid",
    "upstreamUid",
    "externalInterfaces",
    "operatorRoutes",
  ])("rejects changed C2 isolation field %s", (field) => {
    const changed = structuredClone(exposures());
    Object.assign(changed.lanes[0]!.network, {
      [field]: field.endsWith("Uid")
        ? 0
        : field === "operatorRoutes"
          ? ["/"]
          : true,
    });
    expect(() => compileNativeFullHostNetwork(changed)).toThrow(/C2 isolation/);
  });

  it("rejects missing, duplicate and differently allocated lanes", () => {
    const missing = structuredClone(exposures());
    missing.lanes.pop();
    expect(() => compileNativeFullHostNetwork(missing)).toThrow(
      /two independent/,
    );
    const duplicate = structuredClone(exposures());
    duplicate.lanes[1] = duplicate.lanes[0]!;
    expect(() => compileNativeFullHostNetwork(duplicate)).toThrow(
      /two independent/,
    );
    const foreign = structuredClone(exposures());
    foreign.lanes[1]!.allocationId = "different";
    expect(() => compileNativeFullHostNetwork(foreign)).toThrow(
      /one disposable allocation/,
    );
  });
});
