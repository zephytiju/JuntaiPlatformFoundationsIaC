import { expect, it } from "vitest";
import { offlineReaderExposures } from "./fixtures/full-host-readers.js";
import { compileNativeFullHostServiceExposures } from "../src/native-full-host-exposure.js";

it("keeps private readers exact while assigning one dedicated origin per public service", () => {
  const readers = offlineReaderExposures(),
    before = JSON.stringify(readers);
  const full = compileNativeFullHostServiceExposures(readers);
  expect(JSON.stringify(readers)).toBe(before);
  expect(full.nativeAdmission).toBe(false);
  expect(full.readers.map((r) => r.envoy)).toEqual(
    readers.lanes.map((r) => r.envoy),
  );
  expect(full.publicServices.map((s) => s.origin)).toEqual([
    "https://iam.m4.invalid:9443",
    "https://lattice.m4.invalid:9444",
    "https://nous.m4.invalid:9445",
    "https://console.m4.invalid:9448",
  ]);
  for (const service of full.publicServices) {
    expect(Object.isFrozen(service.envoy)).toBe(true);
    const listener = service.envoy.static_resources.listeners[0]!;
    expect(listener.address.socket_address.address).toBe("127.0.0.1");
    const tls = listener.filter_chains[0]!.transport_socket.typed_config;
    expect(tls.require_client_certificate).toBe(false);
    expect(tls.common_tls_context).not.toHaveProperty("validation_context");
    expect(tls.common_tls_context.tls_params).toEqual({
      tls_minimum_protocol_version: "TLSv1_3",
      tls_maximum_protocol_version: "TLSv1_3",
    });
    const http = listener.filter_chains[0]!.filters[0]!.typed_config;
    expect(http.route_config.virtual_hosts).toHaveLength(1);
    expect(http.route_config.virtual_hosts[0]!.domains).toEqual([
      new URL(service.origin).host,
    ]);
    expect(service.envoy.static_resources.clusters).toHaveLength(1);
    expect(http.http_filters.map((f) => f.name)).toEqual([
      "envoy.filters.http.buffer",
      "envoy.filters.http.router",
    ]);
  }
  const issuer = full.publicServices[0]!;
  expect(
    issuer.envoy.static_resources.clusters[0]!.load_assignment.endpoints[0]!
      .lb_endpoints[0]!.endpoint.address.socket_address,
  ).toEqual({ address: "127.0.0.1", port_value: 8000 });
});
