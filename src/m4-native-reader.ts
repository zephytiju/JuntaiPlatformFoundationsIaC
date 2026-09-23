/** Offline selected-reader exposure. No Pulumi registration, IO, or secret access. */
import { createHash } from "node:crypto";

export const M4_PROFILE = "native-casdoor-delegation/v1";
export const PROXY_IMAGE =
  "envoyproxy/envoy:v1.37.0@sha256:d9b4a70739d92b3e28cd407f106b0e90d55df453d7d87773efd22b4429777fe8";
export const M4_CASDOOR_IMAGE =
  "casbin/casdoor:3.125.0@sha256:d7658640aba370495e59dc1464756d2ae7ec66576203b9de0040e9cc37793607";
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const hosts = ["nous", "lattice"] as const;
type Host = (typeof hosts)[number];
export interface Allocation {
  id: string;
  profile: typeof M4_PROFILE;
  isolatedSyntheticOnly: true;
  organizations: string[];
  proxyImage: typeof PROXY_IMAGE;
}
export interface Selection {
  host: Host;
  users: string[];
  applications: string[];
  permissions: string[];
  enforcer: string;
  enforcerTenant: string;
  reader: {
    kind: "User";
    owner: string;
    name: string;
    id: string;
    isAdmin: false;
    isGlobalAdmin: false;
    groups: never[];
    roles: never[];
  };
  readerAudience: string;
}
export interface PublicTrust {
  caSha256: string;
  jwksSha256: string;
  serverCertificateSha256: string;
  clientCertificateSha256: string;
  clientSan: string;
  serverName: string;
}
function exact(v: object, keys: string[]) {
  if (
    !v ||
    Array.isArray(v) ||
    Object.keys(v).sort().join() !== keys.sort().join()
  )
    throw new Error("unexpected schema fields");
}
function hash(v: string) {
  return "sha256:" + createHash("sha256").update(v).digest("hex");
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
export function readerRoutes(selection: Selection) {
  return [
    ...selection.users.map((id) => ({
      method: "GET",
      target: "/api/get-user?id=" + id,
      body: "",
    })),
    ...selection.applications.map((id) => ({
      method: "GET",
      target: "/api/get-application?id=" + id,
      body: "",
    })),
    ...selection.permissions.map((id) => ({
      method: "GET",
      target: "/api/get-permission?id=" + id,
      body: "",
    })),
    {
      method: "POST",
      target: "/api/get-filtered-policies?id=" + selection.enforcer,
      body: "[]",
    },
  ];
}
/** Canonical raw origin-form only: no percent encoding, aliases, duplicates or extras. */
export function readerRequestAllowed(
  selection: Selection,
  method: string,
  target: string,
  body = "",
) {
  return readerRoutes(selection).some(
    (r) => r.method === method && r.target === target && r.body === body,
  );
}
export const DENIED_READER_CASES = Object.freeze([
  "app-or-admin-proof",
  "wrong-user-proof",
  "expired-proof",
  "ttl-over-300",
  "wrong-mtls-san",
  "wrong-ca",
  "rotated-certificate",
  "direct-upstream",
  "public-plane",
  "operator-plane",
  "browser-or-model",
  "other-host-lane",
  "other-selection",
  "mixed-tenant-enforcer",
  "wildcard",
  "duplicate-id",
  "percent-encoded-id",
  "encoded-path",
  "withKey",
  "adapterId",
  "query-credential",
  "list",
  "mutation",
  "oauth",
  "redirect",
  "proxy-env",
]);
export function compile_reader_exposure(
  allocation: Allocation,
  selection: Selection,
  trust: PublicTrust,
) {
  exact(allocation, [
    "id",
    "profile",
    "isolatedSyntheticOnly",
    "organizations",
    "proxyImage",
  ]);
  exact(selection, [
    "host",
    "users",
    "applications",
    "permissions",
    "enforcer",
    "enforcerTenant",
    "reader",
    "readerAudience",
  ]);
  exact(trust, [
    "caSha256",
    "jwksSha256",
    "serverCertificateSha256",
    "clientCertificateSha256",
    "clientSan",
    "serverName",
  ]);
  if (
    !uuid.test(allocation.id) ||
    allocation.profile !== M4_PROFILE ||
    allocation.isolatedSyntheticOnly !== true ||
    allocation.proxyImage !== PROXY_IMAGE
  )
    throw new Error("unqualified allocation or proxy pin");
  const tenant = `m4-${allocation.id}`;
  const readerOrg = `m4-${allocation.id}-readers`;
  if (
    JSON.stringify([...allocation.organizations].sort()) !==
    JSON.stringify([tenant, readerOrg, "juntai-system"].sort())
  )
    throw new Error("real/shared organizations prohibited");
  if (
    !hosts.includes(selection.host) ||
    selection.enforcerTenant !== tenant ||
    selection.enforcer !== `admin/${allocation.id}-tenant-policy`
  )
    throw new Error("dedicated tenant enforcer required");
  const reader = selection.reader;
  exact(reader, [
    "kind",
    "owner",
    "name",
    "id",
    "isAdmin",
    "isGlobalAdmin",
    "groups",
    "roles",
  ]);
  if (
    reader.kind !== "User" ||
    reader.owner !== readerOrg ||
    reader.name !== `${selection.host}-reader` ||
    !uuid.test(reader.id) ||
    reader.isAdmin !== false ||
    reader.isGlobalAdmin !== false ||
    !Array.isArray(reader.groups) ||
    !Array.isArray(reader.roles) ||
    reader.groups.length ||
    reader.roles.length
  )
    throw new Error("non-admin native User required");
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(selection.readerAudience))
    throw new Error("exact reader audience required");
  const check = (values: string[], allowed: (value: string) => boolean) => {
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.length > 64 ||
      new Set(values).size !== values.length ||
      values.some((v) => typeof v !== "string" || !allowed(v))
    )
      throw new Error("ambiguous or non-fixture selection");
  };
  check(selection.users, (v) =>
    [
      tenant + "/human-01",
      "juntai-system/agent-delegated-01",
      "juntai-system/agent-self-01",
    ].includes(v),
  );
  check(selection.applications, (v) =>
    new RegExp(
      `^admin/${allocation.id}-agent-(delegated|self)-(lattice|nous)$`,
    ).test(v),
  );
  check(selection.permissions, (v) =>
    new RegExp(
      `^admin/${allocation.id}-(agent-(delegated|self)-ceiling|grant-[a-f0-9-]{36})$`,
    ).test(v),
  );
  for (const key of [
    "caSha256",
    "jwksSha256",
    "serverCertificateSha256",
    "clientCertificateSha256",
  ] as const) {
    if (!digest.test(trust[key]) || /^sha256:(.)\1{63}$/.test(trust[key]))
      throw new Error("public trust digest required");
  }
  const serverName = `${selection.host}-reader.m4.invalid`;
  if (
    trust.serverName !== serverName ||
    trust.clientSan !== `${selection.host}.${allocation.id}.m4.invalid`
  )
    throw new Error("exact reader certificate lane required");
  const port = selection.host === "nous" ? 9446 : 9447;
  const readerRef = `${reader.owner}/${reader.name}`;
  const nativeRecords = {
    organizations: [tenant, "juntai-system", readerOrg].map((name) => ({
      owner: "admin",
      name,
      isProfilePublic: name !== readerOrg,
    })),
    reader: {
      owner: reader.owner,
      name: reader.name,
      id: reader.id,
      type: "normal-user",
      isAdmin: false,
      isForbidden: false,
      groups: [],
      roles: [],
    },
    readerLoginApplication: {
      owner: "admin",
      name: `${allocation.id}-${selection.host}-reader-login`,
      organization: readerOrg,
      clientId: selection.readerAudience,
      tokenFormat: "JWT",
      expireInHours: 1 / 12,
      grantTypes: ["password"],
      enablePassword: true,
      enableSignUp: false,
      admins: [],
    },
    model: {
      owner: "admin",
      name: `${allocation.id}-reader-api-model`,
      modelText:
        "[request_definition]\nr = sub, obj, act\n[policy_definition]\np = sub, obj, act\n[policy_effect]\ne = some(where (p.eft == allow))\n[matchers]\nm = r.sub == p.sub && r.obj == p.obj && r.act == p.act",
    },
    permissions: [
      ["GET", "get-permission"],
      ["POST", "get-filtered-policies"],
    ].map(([method, endpoint]) => ({
      owner: "admin",
      name: `${allocation.id}-${selection.host}-reader-${method?.toLowerCase()}`,
      users: [readerRef],
      groups: [],
      roles: [],
      model: `admin/${allocation.id}-reader-api-model`,
      resourceType: "API",
      resources: [endpoint],
      actions: [method],
      isEnabled: true,
      state: "Approved",
      effect: "Allow",
    })),
    builtInApiEnforcer: "upstream-owned-do-not-overwrite",
  };
  const routes = readerRoutes(selection);
  // Raw targets are compared BEFORE forwarding; normalization is disabled in HCM.
  const lua = `local allowed = {\n${routes.map((r) => `[${JSON.stringify(r.method + " " + r.target)}] = ${JSON.stringify(r.body)},`).join("\n")}\n}
function envoy_on_request(h)
  local headers = h:headers()
  local key = (headers:get(":method") or "") .. " " .. (headers:get(":path") or "")
  local expected = allowed[key]
  local function deny() h:respond({[":status"]="403"}, "reader denied") end
  if expected == nil or headers:get(":authority") ~= "${serverName}:${port}" then deny(); return end
  if headers:get("cookie") or headers:get("origin") or headers:get("x-forwarded-client-cert") then deny(); return end
  local a = headers:get("authorization") or ""
  if not string.match(a, "^Bearer [%w_-]+%.[%w_-]+%.[%w_-]+$") then deny(); return end
  local m = h:streamInfo():dynamicMetadata():get("envoy.filters.http.jwt_authn")
  local p = m and m.reader
  if not p or p.owner ~= "${reader.owner}" or p.name ~= "${reader.name}" or p.tokenType ~= "access-token" or p.isAdmin ~= false or p.isForbidden ~= false or p.isDeleted ~= false or type(p.iat) ~= "number" or type(p.exp) ~= "number" or p.exp <= p.iat or p.exp-p.iat > 300 then deny(); return end
  local body = h:body()
  local raw = body and body:getBytes(0, body:length()) or ""
  if raw ~= expected then deny(); return end
  if expected == "[]" and headers:get("content-type") ~= "application/json" then deny(); return end
  headers:remove("x-forwarded-for")
  headers:remove("forwarded")
end`;
  const type = (name: string) => "type.googleapis.com/" + name;
  const cluster = (name: string, port: number) => ({
    name,
    connect_timeout: "1s",
    type: "STATIC",
    load_assignment: {
      cluster_name: name,
      endpoints: [
        {
          lb_endpoints: [
            {
              endpoint: {
                address: {
                  socket_address: { address: "127.0.0.1", port_value: port },
                },
              },
            },
          ],
        },
      ],
    },
  });
  const envoy = {
    static_resources: {
      listeners: [
        {
          name: `${selection.host}-reader`,
          address: {
            socket_address: { address: "127.0.0.1", port_value: port },
          },
          filter_chains: [
            {
              transport_socket: {
                name: "envoy.transport_sockets.tls",
                typed_config: {
                  "@type": type(
                    "envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext",
                  ),
                  require_client_certificate: true,
                  common_tls_context: {
                    tls_params: {
                      tls_minimum_protocol_version: "TLSv1_3",
                      tls_maximum_protocol_version: "TLSv1_3",
                    },
                    tls_certificates: [
                      {
                        certificate_chain: {
                          filename: "/run/m4/server-chain.pem",
                        },
                        private_key: { filename: "/run/m4/server-key.pem" },
                      },
                    ],
                    validation_context: {
                      trusted_ca: { filename: "/run/m4/reader-ca.pem" },
                      match_typed_subject_alt_names: [
                        {
                          san_type: "DNS",
                          matcher: { exact: trust.clientSan },
                        },
                      ],
                      verify_certificate_hash: [
                        trust.clientCertificateSha256.slice(7),
                      ],
                    },
                  },
                },
              },
              filters: [
                {
                  name: "envoy.filters.network.http_connection_manager",
                  typed_config: {
                    "@type": type(
                      "envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
                    ),
                    stat_prefix: "selected_reader",
                    normalize_path: false,
                    merge_slashes: false,
                    path_with_escaped_slashes_action: "REJECT_REQUEST",
                    request_timeout: "5s",
                    stream_idle_timeout: "5s",
                    max_request_headers_kb: 8,
                    route_config: {
                      name: "selected_reader",
                      virtual_hosts: [
                        {
                          name: "reader",
                          domains: [`${serverName}:${port}`],
                          routes: [
                            {
                              match: { prefix: "/" },
                              route: {
                                cluster: "casdoor_private",
                                timeout: "5s",
                              },
                            },
                          ],
                        },
                      ],
                    },
                    http_filters: [
                      {
                        name: "envoy.filters.http.buffer",
                        typed_config: {
                          "@type": type(
                            "envoy.extensions.filters.http.buffer.v3.Buffer",
                          ),
                          max_request_bytes: 2,
                        },
                      },
                      {
                        name: "envoy.filters.http.jwt_authn",
                        typed_config: {
                          "@type": type(
                            "envoy.extensions.filters.http.jwt_authn.v3.JwtAuthentication",
                          ),
                          providers: {
                            reader: {
                              issuer: "https://iam.m4.invalid:9443",
                              audiences: [selection.readerAudience],
                              subjects: { exact: reader.id },
                              require_expiration: true,
                              clock_skew_seconds: 0,
                              from_headers: [
                                {
                                  name: "Authorization",
                                  value_prefix: "Bearer ",
                                },
                              ],
                              from_params: [],
                              forward: true,
                              payload_in_metadata: "reader",
                              local_jwks: {
                                filename: "/run/m4/issuer-jwks.json",
                              },
                            },
                          },
                          rules: [
                            {
                              match: { prefix: "/" },
                              requires: { provider_name: "reader" },
                            },
                          ],
                        },
                      },
                      {
                        name: "envoy.filters.http.lua",
                        typed_config: {
                          "@type": type(
                            "envoy.extensions.filters.http.lua.v3.Lua",
                          ),
                          default_source_code: { inline_string: lua },
                        },
                      },
                      {
                        name: "envoy.filters.http.router",
                        typed_config: {
                          "@type": type(
                            "envoy.extensions.filters.http.router.v3.Router",
                          ),
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
      clusters: [cluster("casdoor_private", 8000)],
    },
  };
  const publicEnvoy = structuredClone(envoy);
  const publicListener = publicEnvoy.static_resources.listeners[0]!;
  publicListener.name = "native-issuer-public";
  publicListener.address.socket_address.port_value = 9443;
  const publicChain = publicListener.filter_chains[0]!;
  publicChain.transport_socket.typed_config.require_client_certificate = false;
  publicChain.transport_socket.typed_config.common_tls_context.tls_certificates =
    [
      {
        certificate_chain: { filename: "/run/m4/issuer-chain.pem" },
        private_key: { filename: "/run/m4/issuer-key.pem" },
      },
    ];
  // Separate server-only TLS lane: reader certificate and bearer grant nothing here.
  delete (
    publicChain.transport_socket.typed_config.common_tls_context as {
      validation_context?: unknown;
    }
  ).validation_context;
  const publicHcm = publicChain.filters[0]!.typed_config;
  publicHcm.stat_prefix = "native_issuer";
  publicHcm.route_config.virtual_hosts[0]!.domains = ["iam.m4.invalid:9443"];
  publicHcm.http_filters = [
    {
      name: "envoy.filters.http.buffer",
      typed_config: {
        "@type": type("envoy.extensions.filters.http.buffer.v3.Buffer"),
        max_request_bytes: 8192,
      },
    },
    {
      name: "envoy.filters.http.lua",
      typed_config: {
        "@type": type("envoy.extensions.filters.http.lua.v3.Lua"),
        default_source_code: {
          inline_string: `
function envoy_on_request(h)
 local a = h:headers()
 local path, method = a:get(":path"), a:get(":method")
 local ok = (method == "GET" and path == "/.well-known/jwks") or (method == "POST" and path == "/api/login/oauth/access_token" and a:get("content-type") == "application/json")
 if not ok or a:get(":authority") ~= "iam.m4.invalid:9443" or a:get("authorization") or a:get("cookie") or a:get("origin") then
  h:respond({[":status"]="403"}, "native route denied"); return
 end
 local b = h:body()
 if method == "GET" and b and b:length() ~= 0 then h:respond({[":status"]="403"}, "native route denied"); return end
end`,
        },
      },
    },
    {
      name: "envoy.filters.http.router",
      typed_config: {
        "@type": type("envoy.extensions.filters.http.router.v3.Router"),
      },
    },
  ];
  // One namespace per allocation, isolated UIDs. nft is applied BEFORE starting
  // any listener. No host wildcard bind or upstream published port is permitted.
  const nft = `table inet m4_reader {\n chain output { type filter hook output priority 0; policy drop;\n ct state established,related accept\n meta skuid 21001 ip daddr 127.0.0.1 tcp dport 8000 accept\n meta skuid 21002 ip daddr 127.0.0.1 tcp dport 9446 accept\n meta skuid 21004 ip daddr 127.0.0.1 tcp dport 8000 accept\n meta skuid 21005 ip daddr 127.0.0.1 tcp dport 9447 accept\n meta skuid 21007 ip daddr 127.0.0.1 tcp dport 8000 accept\n meta skuid 21002 ip daddr 127.0.0.1 tcp dport 9443 accept\n meta skuid 21005 ip daddr 127.0.0.1 tcp dport 9443 accept\n }\n chain input { type filter hook input priority 0; policy drop;\n iifname "lo" accept\n }\n}\n`;
  const artifact = {
    schemaVersion: "juntai.platform/m4-native-reader/v1",
    profile: M4_PROFILE,
    allocationId: allocation.id,
    host: selection.host,
    nativeRecords,
    routes,
    envoy,
    publicEnvoy,
    network: {
      nft,
      proxyUid: selection.host === "nous" ? 21001 : 21004,
      consumerUid: selection.host === "nous" ? 21002 : 21005,
      namespace: `m4-${allocation.id}`,
      upstreamUid: 21003,
      externalInterfaces: false,
      publicRoutes: [
        "GET /.well-known/jwks",
        "POST /api/login/oauth/access_token without bearer",
      ],
      operatorRoutes: [],
    },
    trust: structuredClone(trust),
    proxyImage: PROXY_IMAGE,
    casdoorImage: M4_CASDOOR_IMAGE,
    admission: {
      nativeTests: "NOT RUN",
      requires: [
        "manifest-bound allocation approval",
        "real proxy validation",
        "dedicated namespace and non-root UID enforcement",
        "public trust file digest validation",
        "native User token proof",
        "masked native responses",
        "native deny matrix",
      ],
      startup: [
        "create isolated namespace",
        "apply nft before listeners",
        "mount provider-owned secrets and verified public trust read-only",
        "start Casdoor privately",
        "start pinned Envoy as proxy UID",
        "admit consumer UID only after native ACL gate",
      ],
      rotation:
        "close and restart lane; revoke old native User token; replace pins; rerun admission before traffic",
      teardown:
        "stop consumer, proxy and Casdoor; delete namespace and allocation-owned secret mounts; verify zero owned resources",
    },
    denied: DENIED_READER_CASES,
  };
  return frozen({ ...artifact, configSha256: hash(JSON.stringify(artifact)) });
}

/** Compose both lanes before allocation; reject identity/audience/certificate aliasing. */
export function compile_reader_exposures(
  allocation: Allocation,
  selections: Selection[],
  trusts: PublicTrust[],
) {
  if (
    selections.length !== 2 ||
    trusts.length !== 2 ||
    new Set(selections.map((x) => x.host)).size !== 2 ||
    new Set(selections.map((x) => x.reader.id)).size !== 2 ||
    new Set(selections.map((x) => x.readerAudience)).size !== 2 ||
    new Set(trusts.map((x) => x.clientCertificateSha256)).size !== 2
  )
    throw new Error("independent reader lanes required");
  const lanes = selections.map((selection, index) =>
    compile_reader_exposure(allocation, selection, trusts[index]!),
  );
  if (
    JSON.stringify(lanes[0]!.publicEnvoy) !==
    JSON.stringify(lanes[1]!.publicEnvoy)
  )
    throw new Error("public exposure conflict");
  return frozen({ profile: M4_PROFILE, lanes, nativeTests: "NOT RUN" });
}
