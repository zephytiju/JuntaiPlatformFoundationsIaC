import * as k8s from "@pulumi/kubernetes";
import { fetchVerifiedArtifact, type ArtifactFetcher } from "./artifacts.js";
import { createBlueprint } from "./blueprint.js";
import {
  FoundationServicesCapability,
  GatewaySetCapability,
  MeridianRuntimeCapability,
  ObservabilityGatewayCapability,
} from "./capabilities.js";
import { createCasdoor } from "./casdoor.js";
import type { PackageContext, PlatformIacPackage } from "./contract.js";
import { createGatewaySet } from "./gateway.js";
import { createMeridianRuntime } from "./meridian.js";
import { FoundationNamespaceSet } from "./namespaces.js";
import { createObservabilityGateway } from "./observability.js";
import {
  FOUNDATIONS_PACKAGE_ID,
  FOUNDATIONS_PACKAGE_VERSION,
  releaseInputs,
} from "./release.js";
import type {
  FoundationServicesOutput,
  FoundationsInputs,
  FoundationsOutputs,
  FoundationsProviders,
} from "./types.js";
import { validateFoundationsInputs } from "./validation.js";

export interface DeploymentDependencies {
  readonly fetcher?: ArtifactFetcher;
}

export async function deployFoundations(
  context: PackageContext<FoundationsProviders, FoundationsInputs>,
  dependencies: DeploymentDependencies = {},
): Promise<{ readonly outputs: FoundationsOutputs }> {
  validateFoundationsInputs(context.inputs);
  const provider = context.providers.kubernetes;
  if (!(provider instanceof k8s.Provider)) {
    throw new Error(
      "juntai.platform.substrate requires the Core-owned Kubernetes provider",
    );
  }
  const fetcher = dependencies.fetcher ?? fetchVerifiedArtifact;
  const namespaces = new FoundationNamespaceSet("foundations", {
    provider,
    adoption: context.inputs.adoption,
  });
  const namespaceResources = Object.values(namespaces.resources);
  const gatewaySet = await createGatewaySet({
    provider,
    namespace: namespaces.resources["juntai-gateway"].metadata.name,
    inputs: context.inputs.gateway,
    adoption: context.inputs.adoption,
    dependsOn: namespaceResources,
    fetcher,
  });
  const meridian = createMeridianRuntime({
    provider,
    namespace: namespaces.resources["juntai-capabilities"].metadata.name,
    inputs: context.inputs.meridian,
    adoption: context.inputs.adoption,
    dependsOn: namespaceResources,
  });
  const observabilityGateway = createObservabilityGateway({
    provider,
    namespace: namespaces.resources["juntai-observability"].metadata.name,
    inputs: context.inputs.observability,
    adoption: context.inputs.adoption,
    dependsOn: namespaceResources,
  });
  const casdoor = createCasdoor({
    provider,
    namespace: namespaces.resources["juntai-iam"].metadata.name,
    stage: context.target.environment,
    inputs: context.inputs.casdoor,
    gatewaySet,
    adoption: context.inputs.adoption,
  });
  const blueprint = await createBlueprint({
    provider,
    namespace: namespaces.resources["juntai-platform"].metadata.name,
    inputs: context.inputs.blueprint,
    gatewaySet,
    meridianRuntime: meridian.runtime,
    observability: observabilityGateway,
    adoption: context.inputs.adoption,
    fetcher,
  });
  const foundationServices: FoundationServicesOutput = Object.freeze({
    casdoor,
    ...(blueprint === undefined ? {} : { blueprint }),
  });
  context.capabilities.provide(GatewaySetCapability, gatewaySet);
  context.capabilities.provide(MeridianRuntimeCapability, meridian.output);
  context.capabilities.provide(
    ObservabilityGatewayCapability,
    observabilityGateway,
  );
  context.capabilities.provide(
    FoundationServicesCapability,
    foundationServices,
  );
  return Object.freeze({
    outputs: Object.freeze({
      foundationServices,
      gatewaySet,
      meridianRuntime: meridian.output,
      observabilityGateway,
    }),
  });
}

const foundationsPackage: PlatformIacPackage<
  FoundationsProviders,
  FoundationsInputs,
  FoundationsOutputs
> = Object.freeze({
  id: FOUNDATIONS_PACKAGE_ID,
  version: FOUNDATIONS_PACKAGE_VERSION,
  targetProfiles: [
    "development",
    "development-local",
    "production",
    "staging",
  ] as const,
  owners: ["@juntai/platform-infrastructure"],
  compatibility: {
    coreContract: "^1.1.0",
    capabilityContracts: "^1.0.0",
    constructLibraries: {
      "juntai.platform.constructs": "^1.0.0",
      "juntai.platform.constructs.meridian": "^1.0.0",
    },
  },
  releaseInputs,
  requires: [],
  provides: [
    GatewaySetCapability,
    MeridianRuntimeCapability,
    ObservabilityGatewayCapability,
    FoundationServicesCapability,
  ],
  deploy: deployFoundations,
});

export default foundationsPackage;
