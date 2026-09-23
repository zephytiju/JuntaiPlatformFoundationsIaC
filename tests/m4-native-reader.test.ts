import { renderReaderInput } from "../src/m4-native-reader-cli.js";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  compile_reader_exposure,
  compile_reader_exposures,
  readerRequestAllowed,
  M4_PROFILE,
  PROXY_IMAGE,
  type Allocation,
  type Selection,
  type PublicTrust,
} from "../src/m4-native-reader.js";
const id = "33c0cb57-a3c6-4309-aa48-82e937522d7d";
const sha = (s: string) =>
  "sha256:" + createHash("sha256").update(s).digest("hex");
export function fixture() {
  const allocation: Allocation = {
    id,
    profile: M4_PROFILE,
    isolatedSyntheticOnly: true,
    organizations: [`m4-${id}`, `m4-${id}-readers`, "juntai-system"],
    proxyImage: PROXY_IMAGE,
  };
  const selection: Selection = {
    host: "nous",
    users: [`m4-${id}/human-01`, "juntai-system/agent-delegated-01"],
    applications: [`admin/${id}-agent-delegated-lattice`],
    permissions: [`admin/${id}-agent-delegated-ceiling`],
    enforcer: `admin/${id}-tenant-policy`,
    enforcerTenant: `m4-${id}`,
    reader: {
      kind: "User",
      owner: `m4-${id}-readers`,
      name: "nous-reader",
      id: "42c0cb57-a3c6-4309-aa48-82e937522d7d",
      isAdmin: false,
      isGlobalAdmin: false,
      groups: [],
      roles: [],
    },
    readerAudience: "reader-client-id",
  };
  const trust: PublicTrust = {
    caSha256: sha("OFFLINE TEST CA"),
    jwksSha256: sha("OFFLINE TEST JWKS"),
    serverCertificateSha256: sha("OFFLINE TEST SERVER"),
    clientCertificateSha256: sha("OFFLINE TEST CLIENT"),
    clientSan: `nous.${id}.m4.invalid`,
    serverName: "nous-reader.m4.invalid",
  };
  return { allocation, selection, trust };
}
describe("M4 offline compiler; native tests NOT RUN", () => {
  it("compiles deterministic deeply immutable native/config/network output", () => {
    const { allocation, selection, trust } = fixture();
    const a = compile_reader_exposure(allocation, selection, trust);
    expect(a).toEqual(compile_reader_exposure(allocation, selection, trust));
    expect(Object.isFrozen(a.envoy)).toBe(true);
    expect(
      a.nativeRecords.permissions.map((x) => [x.actions, x.resources, x.users]),
    ).toEqual([
      [["GET"], ["get-permission"], [`${selection.reader.owner}/nous-reader`]],
      [
        ["POST"],
        ["get-filtered-policies"],
        [`${selection.reader.owner}/nous-reader`],
      ],
    ]);
    expect(a.network.nft).toContain("policy drop");
    expect(a.network.nft).toContain(
      "meta skuid 21005 ip daddr 127.0.0.1 tcp dport 9447 accept",
    );
    expect(JSON.stringify(a)).not.toMatch(
      /SPIRE|SVID|signingKey|BEGIN PRIVATE/,
    );
    expect(a.admission.nativeTests).toBe("NOT RUN");
    for (const route of a.routes)
      expect(
        readerRequestAllowed(selection, route.method, route.target, route.body),
      ).toBe(true);
  });
  it.each([
    "&id=evil/x",
    "&withKey=1",
    "&adapterId=x",
    "&access_token=x",
    "&client_id=x",
    "&",
    "#x",
    ";x",
  ])("rejects query suffix %s", (suffix) => {
    const { selection } = fixture();
    expect(
      readerRequestAllowed(
        selection,
        "GET",
        "/api/get-user?id=" + selection.users[0] + suffix,
      ),
    ).toBe(false);
  });
  it.each([
    "/api/get-users",
    "/api/update-user",
    "/api/login/oauth/access_token",
    "/api/get-user/",
    "/api/%67et-user",
    "//api/get-user",
    "/api/../api/get-user",
  ])("rejects alternate path %s", (path) => {
    const { selection } = fixture();
    expect(
      readerRequestAllowed(
        selection,
        "GET",
        path + "?id=" + selection.users[0],
      ),
    ).toBe(false);
  });
  it.each(["HEAD", "POST", "PUT", "PATCH", "DELETE", "get", "OPTIONS"])(
    "rejects method %s",
    (method) => {
      const { selection } = fixture();
      expect(
        readerRequestAllowed(
          selection,
          method,
          "/api/get-user?id=" + selection.users[0],
        ),
      ).toBe(false);
    },
  );
  it.each(["[] ", "[ ]", "{}", "[0]", "null", "", '["tenant"]'])(
    "rejects noncanonical policy body %s",
    (body) => {
      const { selection } = fixture();
      expect(
        readerRequestAllowed(
          selection,
          "POST",
          "/api/get-filtered-policies?id=" + selection.enforcer,
          body,
        ),
      ).toBe(false);
    },
  );
  it("rejects encoded IDs, bodies on GET, and different selections", () => {
    const { selection } = fixture();
    for (const id of [
      "other/human-01",
      "juntai-system/agent-self-01",
      encodeURIComponent(selection.users[0]!),
      "*",
      "admin/x",
      selection.users[0] + "%00",
    ])
      expect(
        readerRequestAllowed(selection, "GET", "/api/get-user?id=" + id),
      ).toBe(false);
    expect(
      readerRequestAllowed(
        selection,
        "GET",
        "/api/get-user?id=" + selection.users[0],
        "[]",
      ),
    ).toBe(false);
  });
  it.each([
    "admin",
    "app",
    "real-org",
    "wildcard",
    "duplicate",
    "shared-enforcer",
    "absent-pin",
    "wrong-proxy",
    "unknown-field",
    "wrong-san",
  ])("rejects unsafe descriptor %s", (scenario) => {
    const f = fixture();
    if (scenario === "admin")
      (f.selection.reader as unknown as { isAdmin: boolean }).isAdmin = true;
    if (scenario === "app")
      (f.selection.reader as unknown as { kind: string }).kind = "Application";
    if (scenario === "real-org") f.allocation.organizations.push("production");
    if (scenario === "wildcard") f.selection.users = ["*"];
    if (scenario === "duplicate") f.selection.users.push(f.selection.users[0]!);
    if (scenario === "shared-enforcer") f.selection.enforcer = "admin/shared";
    if (scenario === "absent-pin") f.trust.caSha256 = "";
    if (scenario === "wrong-proxy")
      (f.allocation as unknown as { proxyImage: string }).proxyImage =
        "envoyproxy/envoy:latest";
    if (scenario === "unknown-field")
      Object.assign(f.selection, { withKey: true });
    if (scenario === "wrong-san")
      f.trust.clientSan = "lattice." + id + ".m4.invalid";
    expect(() =>
      compile_reader_exposure(f.allocation, f.selection, f.trust),
    ).toThrow();
  });
  it("keeps two host listeners and client certificates distinct", () => {
    const f = fixture();
    const nous = compile_reader_exposure(f.allocation, f.selection, f.trust);
    f.selection.host = "lattice";
    f.selection.reader.name = "lattice-reader";
    f.trust.clientSan = `lattice.${id}.m4.invalid`;
    f.trust.serverName = "lattice-reader.m4.invalid";
    const lattice = compile_reader_exposure(f.allocation, f.selection, f.trust);
    expect(lattice.network.namespace).toBe(nous.network.namespace);
    expect(lattice.network.consumerUid).not.toBe(nous.network.consumerUid);
    expect(
      lattice.envoy.static_resources.listeners[0]?.address.socket_address
        .port_value,
    ).toBe(9447);
  });
});

it("renderer rejects duplicate JSON fields before compilation", () => {
  expect(() =>
    renderReaderInput(
      '{"allocation":{},"allocation":{},"exactSelection":{},"publicTrust":{}}',
    ),
  ).toThrow("ambiguous");
  const { allocation, selection, trust } = fixture();
  expect(
    renderReaderInput(
      JSON.stringify({
        allocation,
        exactSelection: selection,
        publicTrust: trust,
      }),
    ),
  ).toEqual(compile_reader_exposure(allocation, selection, trust));
});

it("rejects reuse of a reader identity across the composed lanes", () => {
  const f = fixture();
  expect(() =>
    compile_reader_exposures(
      f.allocation,
      [f.selection, f.selection],
      [f.trust, f.trust],
    ),
  ).toThrow("independent");
});
