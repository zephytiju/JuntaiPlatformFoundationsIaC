import { createHash } from "node:crypto";
import type { compile_reader_exposures } from "./m4-native-reader.js";
import { compileNativeFullHostNetwork } from "./native-full-host-network.js";

/** Dedicated origin forwarding for the full-host environment. Authorization
 * remains in the native issuer and domain services; caller-supplied headers do
 * not assign process roles. Original private reader configs are retained whole.
 */
export function compileNativeFullHostServiceExposures(
  readers: ReturnType<typeof compile_reader_exposures>,
) {
  const network = compileNativeFullHostNetwork(readers);
  const publicServices = [
    {
      role: "issuerProxy",
      name: "iam",
      port: network.listeners.issuer,
      upstream: network.listeners.casdoor,
    },
    {
      role: "latticeProxy",
      name: "lattice",
      port: network.listeners.lattice,
      upstream: network.listeners.latticeUpstream,
    },
    {
      role: "nousProxy",
      name: "nous",
      port: network.listeners.nous,
      upstream: network.listeners.nousUpstream,
    },
    {
      role: "consoleProxy",
      name: "console",
      port: network.listeners.console,
      upstream: network.listeners.consoleUpstream,
    },
  ] as const;
  const exposures = publicServices.map((service) => {
    const envoy = structuredClone(readers.lanes[0]!.publicEnvoy);
    const listener = envoy.static_resources.listeners[0]!;
    listener.name = "full-host-" + service.name;
    listener.address.socket_address.port_value = service.port;
    const chain = listener.filter_chains[0]!;
    chain.transport_socket.typed_config.common_tls_context.tls_certificates = [
      {
        certificate_chain: { filename: "/run/m4/server-chain.pem" },
        private_key: { filename: "/run/m4/server-key.pem" },
      },
    ];
    const hcm = chain.filters[0]!.typed_config;
    hcm.stat_prefix = "full_host_" + service.name;
    hcm.request_timeout = "10s";
    // Runtime start/resume return after execution. Allow its bounded 180s run
    // plus response overhead through both the Nous and Console proxy hops.
    const responseTimeout =
      service.role === "nousProxy" || service.role === "consoleProxy"
        ? "200s"
        : "60s";
    hcm.stream_idle_timeout = responseTimeout;
    hcm.route_config.name = "full-host-" + service.name;
    const virtualHost = hcm.route_config.virtual_hosts[0]!;
    virtualHost.name = service.name;
    virtualHost.domains = [`${service.name}.m4.invalid:${service.port}`];
    virtualHost.routes[0]!.route.cluster = service.name + "_private";
    virtualHost.routes[0]!.route.timeout = responseTimeout;
    hcm.http_filters = [
      {
        name: "envoy.filters.http.buffer",
        typed_config: {
          "@type":
            "type.googleapis.com/envoy.extensions.filters.http.buffer.v3.Buffer",
          max_request_bytes: 1_048_576,
        },
      },
      {
        name: "envoy.filters.http.router",
        typed_config: {
          "@type":
            "type.googleapis.com/envoy.extensions.filters.http.router.v3.Router",
        },
      },
    ];
    const cluster = envoy.static_resources.clusters[0]!;
    cluster.name = service.name + "_private";
    cluster.load_assignment.cluster_name = cluster.name;
    cluster.load_assignment.endpoints[0]!.lb_endpoints[0]!.endpoint.address.socket_address.port_value =
      service.upstream;
    if (service.role === "issuerProxy") {
      // Kernel-selected host traffic retains the original C2 token/JWKS-only
      // HTTP gate. TLS and the logical issuer origin stay iam:9443; no request
      // header can select the broader browser listener or change its source UID.
      const restricted = structuredClone(
        readers.lanes[0]!.publicEnvoy.static_resources.listeners[0]!,
      );
      restricted.name = "full-host-issuer-restricted";
      restricted.address.socket_address.port_value =
        network.listeners.issuerRestricted;
      const restrictedChain = restricted.filter_chains[0]!;
      restrictedChain.transport_socket.typed_config.common_tls_context.tls_certificates =
        structuredClone(
          chain.transport_socket.typed_config.common_tls_context
            .tls_certificates,
        );
      restrictedChain.filters[0]!.typed_config.route_config.virtual_hosts[0]!.routes[0]!.route.cluster =
        cluster.name;
      envoy.static_resources.listeners.push(restricted);
    }
    return {
      role: service.role,
      origin: `https://${service.name}.m4.invalid:${service.port}`,
      envoy,
    };
  });
  const value = {
    schemaVersion: "juntai.platform/native-full-host-exposure/v1",
    allocationId: network.allocationId,
    network,
    readers: readers.lanes.map((lane) => ({
      role: lane.host + "Reader",
      configSha256: lane.configSha256,
      envoy: lane.envoy,
    })),
    publicServices: exposures,
    nativeAdmission: false,
    authorization:
      "native issuer and receiving domain; trusted process roles enforced by kernel policy",
  };
  const result = {
    ...value,
    configSha256:
      "sha256:" +
      createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  };
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(result);
  return result;
}
