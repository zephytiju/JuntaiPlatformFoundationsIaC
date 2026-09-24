import { createHash } from "node:crypto";
import type { compile_reader_exposures } from "./m4-native-reader.js";

/** Deployment identities, never values accepted from an HTTP request. */
export const FULL_HOST_UIDS = Object.freeze({
  nousReader: 21001,
  nous: 21002,
  casdoor: 21003,
  latticeReader: 21004,
  lattice: 21005,
  issuerProxy: 21007,
  console: 21008,
  browser: 21009,
  operator: 21010,
  independentClient: 21012,
  nousProxy: 21013,
  latticeProxy: 21014,
  consoleProxy: 21015,
  model: 21020,
  objects: 21022,
  collector: 21023,
  domainDatabase: 21030,
  casdoorDatabase: 21031,
  telemetryDatabase: 21032,
});

const listeners = Object.freeze({
  casdoor: 8000,
  issuer: 9443,
  issuerRestricted: 19443,
  lattice: 9444,
  nous: 9445,
  nousReader: 9446,
  latticeReader: 9447,
  console: 9448,
  model: 9843,
  domainDatabase: 15432,
  casdoorDatabase: 15433,
  objects: 19000,
  collectorHttp: 4318,
  collectorGrpc: 4317,
  collectorRelay: 18180,
  telemetryDatabase: 8443,
  latticeUpstream: 18044,
  nousUpstream: 18045,
  consoleUpstream: 18048,
});

type Role = keyof typeof FULL_HOST_UIDS;
type Target = keyof typeof listeners;
const allowed: Readonly<Record<Role, readonly Target[]>> = Object.freeze({
  nousReader: ["casdoor"],
  nous: [
    "issuerRestricted",
    "nousReader",
    "lattice",
    "model",
    "domainDatabase",
    "objects",
    "collectorHttp",
    "collectorGrpc",
    "telemetryDatabase",
  ],
  casdoor: ["casdoorDatabase"],
  latticeReader: ["casdoor"],
  lattice: ["issuerRestricted", "latticeReader", "domainDatabase"],
  issuerProxy: ["casdoor"],
  console: ["issuer", "nous", "lattice"],
  browser: ["issuer", "console", "nous"],
  operator: [
    "issuer",
    "nous",
    "lattice",
    "domainDatabase",
    "objects",
    "collectorHttp",
    "telemetryDatabase",
  ],
  independentClient: [
    "issuerRestricted",
    "nous",
    "lattice",
    "model",
    "collectorHttp",
  ],
  nousProxy: ["nousUpstream"],
  latticeProxy: ["latticeUpstream"],
  consoleProxy: ["consoleUpstream"],
  model: [],
  objects: [],
  collector: ["collectorRelay", "telemetryDatabase"],
  domainDatabase: [],
  casdoorDatabase: [],
  telemetryDatabase: [],
});

/** New full-host deployment policy. Original C2 artifacts remain unchanged.
 * The caller deploys only each lane's original Envoy reader configuration and
 * this combined policy. The old publicEnvoy and standalone nft policy are not
 * installed together with it. All services must share a sealed Linux namespace.
 */
export function compileNativeFullHostNetwork(
  exposures: ReturnType<typeof compile_reader_exposures>,
) {
  if (
    exposures.lanes.length !== 2 ||
    JSON.stringify(exposures.lanes.map((lane) => lane.host).sort()) !==
      '["lattice","nous"]'
  )
    throw new Error("two independent C2 reader lanes required");
  for (const lane of exposures.lanes) {
    const expected = lane.host === "nous" ? [21001, 21002] : [21004, 21005];
    if (
      lane.network.externalInterfaces !== false ||
      lane.network.proxyUid !== expected[0] ||
      lane.network.consumerUid !== expected[1] ||
      lane.network.upstreamUid !== 21003 ||
      lane.network.operatorRoutes.length !== 0
    )
      throw new Error("C2 isolation or trusted UID selection differs");
  }
  if (exposures.lanes[0]!.allocationId !== exposures.lanes[1]!.allocationId)
    throw new Error("reader lanes must share one disposable allocation");
  const edges = Object.entries(allowed).flatMap(([role, targets]) =>
    targets.map((target) => ({
      role: role as Role,
      uid: FULL_HOST_UIDS[role as Role],
      target,
      address: "127.0.0.1" as const,
      port: listeners[target],
    })),
  );
  const issuerRedirects = (
    ["nous", "lattice", "independentClient"] as const
  ).map((role) => ({
    role,
    uid: FULL_HOST_UIDS[role],
    address: "127.0.0.1" as const,
    port: listeners.issuer,
    targetPort: listeners.issuerRestricted,
  }));
  const nft = [
    "table inet nous_full_host {",
    " chain issuer_select { type nat hook output priority -100; policy accept;",
    ...issuerRedirects.map(
      (edge) =>
        `  meta skuid ${edge.uid} ip daddr 127.0.0.1 tcp dport ${edge.port} redirect to :${edge.targetPort}`,
    ),
    " }",
    " chain output { type filter hook output priority 0; policy drop;",
    "  ct state established,related accept",
    ...edges.map(
      (edge) =>
        `  meta skuid ${edge.uid} ip daddr 127.0.0.1 tcp dport ${edge.port} accept`,
    ),
    " }",
    " chain input { type filter hook input priority 0; policy drop;",
    '  iifname "lo" accept',
    " }",
    "}",
    "",
  ].join("\n");
  return Object.freeze({
    schemaVersion: "juntai.platform/native-full-host-network/v1",
    allocationId: exposures.lanes[0]!.allocationId,
    externalInterfaces: false,
    credentialForwardingBridges: false,
    listeners,
    uids: FULL_HOST_UIDS,
    edges: Object.freeze(edges.map((edge) => Object.freeze(edge))),
    issuerRedirects: Object.freeze(
      issuerRedirects.map((edge) => Object.freeze(edge)),
    ),
    nft,
    policySha256: "sha256:" + createHash("sha256").update(nft).digest("hex"),
    readerConfigSha256: exposures.lanes.map((lane) => lane.configSha256),
    nativeAdmission: false,
    requiredLiveGates: [
      "stage immutable images and model before sealing",
      "remove every non-loopback interface before starting services",
      "load and read back the exact default-deny nft policy",
      "drop all capabilities and disallow privilege escalation in every service",
      "prove source UIDs, cross-reader denial and direct-upstream denial",
      "verify original C2 mTLS, native User proofs and exact object ACLs",
      "verify each service trust, storage admission and application authorization",
    ],
  });
}
