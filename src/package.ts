import * as k8s from "@pulumi/kubernetes";
import { createAccount } from "./account.js";
import { createApplicationMetadata } from "./application-metadata.js";
import type { ArtifactFetcher } from "./artifacts.js";
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
import { registerLegacyAdoptionCompatibility } from "./legacy-adoption-compatibility.js";
import { createMeridianRuntime } from "./meridian.js";
import { FoundationNamespaceSet } from "./namespaces.js";
import { createObservabilityGateway } from "./observability.js";
import {
  resolveFoundationPreflight,
  type FoundationPreflightResolver,
} from "./preflight.js";
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
  readonly preflight?: FoundationPreflightResolver;
}

export async function deployFoundations(
  context: PackageContext<FoundationsProviders, FoundationsInputs>,
  dependencies: DeploymentDependencies = {},
): Promise<{ readonly outputs: FoundationsOutputs }> {
  validateFoundationsInputs(context.inputs);
  const provider = context.providers.kubernetes;
  if (!k8s.Provider.isInstance(provider)) {
    throw new Error(
      "juntai.platform.substrate requires the Core-owned Kubernetes provider",
    );
  }
  const preflight = await (
    dependencies.preflight ?? resolveFoundationPreflight
  )(context.inputs, dependencies.fetcher);
  registerLegacyAdoptionCompatibility(
    context.inputs.legacyAdoptionCompatibility,
  );
  const blueprintRoute = preflight.contracts.routes.find(
    ({ serviceId }) => serviceId === "platform.blueprint",
  );
  const accountRoute = preflight.contracts.routes.find(
    ({ serviceId }) => serviceId === "platform.account",
  );
  const applicationMetadataRoute = preflight.contracts.routes.find(
    ({ serviceId }) => serviceId === "platform.application-metadata",
  );
  if (
    context.inputs.blueprint.enabled !== false &&
    blueprintRoute === undefined
  ) {
    throw new Error(
      "verified Blueprint contract did not produce its deployment route",
    );
  }
  if (context.inputs.account.enabled !== false && accountRoute === undefined) {
    throw new Error(
      "verified Account contract did not produce its deployment route",
    );
  }
  if (
    context.inputs.applicationMetadata.enabled !== false &&
    applicationMetadataRoute === undefined
  ) {
    throw new Error(
      "verified Application Metadata contract did not produce its deployment route",
    );
  }
  const namespaces = new FoundationNamespaceSet("foundations", {
    provider,
    adoption: context.inputs.adoption,
  });
  const namespaceResources = Object.values(namespaces.resources);
  const gatewaySet = createGatewaySet({
    provider,
    namespace: namespaces.resources["juntai-gateway"].metadata.name,
    inputs: context.inputs.gateway,
    adoption: context.inputs.adoption,
    dependsOn: namespaceResources,
    gatewayApiYaml: preflight.gatewayApiYaml,
    envoyGatewayYaml: preflight.envoyGatewayYaml,
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
  const blueprint = createBlueprint({
    provider,
    namespace: namespaces.resources["juntai-platform"].metadata.name,
    stage: context.target.environment,
    inputs: context.inputs.blueprint,
    gatewaySet,
    casdoor,
    meridianRuntime: meridian.blueprintRuntime,
    meridianRuntimeReferences: context.inputs.meridian.runtimeReferences,
    observability: observabilityGateway,
    adoption: context.inputs.adoption,
    ...(blueprintRoute === undefined ? {} : { route: blueprintRoute }),
  });
  const account = createAccount({
    provider,
    namespace: namespaces.resources["juntai-platform"].metadata.name,
    stage: context.target.environment,
    inputs: context.inputs.account,
    gatewaySet,
    meridianRuntime: meridian.runtime,
    meridianRuntimeReferences: context.inputs.meridian.runtimeReferences,
    observability: observabilityGateway,
    adoption: context.inputs.adoption,
    ...(accountRoute === undefined ? {} : { route: accountRoute }),
  });
  const applicationMetadata = createApplicationMetadata({
    provider,
    namespace: namespaces.resources["juntai-platform"].metadata.name,
    stage: context.target.environment,
    inputs: context.inputs.applicationMetadata,
    gatewaySet,
    casdoor,
    meridianRuntime: meridian.applicationMetadataRuntime,
    meridianRuntimeReferences: context.inputs.meridian.runtimeReferences,
    observability: observabilityGateway,
    adoption: context.inputs.adoption,
    ...(applicationMetadataRoute === undefined
      ? {}
      : { route: applicationMetadataRoute }),
  });
  const foundationServices: FoundationServicesOutput = Object.freeze({
    ...(account === undefined ? {} : { account }),
    ...(applicationMetadata === undefined ? {} : { applicationMetadata }),
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
      contractComposition: preflight.contracts.evidence,
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
