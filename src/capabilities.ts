import type { CapabilityKey } from "./contract.js";
import type {
  FoundationServicesOutput,
  GatewaySetOutput,
  MeridianRuntimeOutput,
  ObservabilityGatewayOutput,
} from "./types.js";

export const GatewaySetCapability = Object.freeze({
  id: "juntai.platform.gateway-set",
  version: "1.0.0",
  multiplexed: false,
}) satisfies CapabilityKey<GatewaySetOutput>;

export const MeridianRuntimeCapability = Object.freeze({
  id: "juntai.platform.meridian-runtime",
  version: "1.0.0",
  multiplexed: false,
}) satisfies CapabilityKey<MeridianRuntimeOutput>;

export const ObservabilityGatewayCapability = Object.freeze({
  id: "juntai.platform.observability-gateway",
  version: "1.0.0",
  multiplexed: false,
}) satisfies CapabilityKey<ObservabilityGatewayOutput>;

export const FoundationServicesCapability = Object.freeze({
  id: "juntai.platform.foundation-services",
  version: "1.1.0",
  multiplexed: false,
}) satisfies CapabilityKey<FoundationServicesOutput>;
