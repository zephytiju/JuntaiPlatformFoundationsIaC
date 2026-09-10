import type * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import type { ContractCompositionEvidence } from "./contract-composition.js";
import type { VerifiedArtifact } from "./artifacts.js";
import type { RuntimeDistributionDescriptor } from "./runtime-distribution.js";
import type {
  AclPolicyRef,
  JsonObject,
  MigrationStateV1,
  MeridianResourceRequirementV1,
  ResourceSelectorV1,
  ObservabilityBindingV1,
  OpaqueIdentityRef,
  OpaqueSecretRef,
  RecoveryCapabilityV1,
  TlsPolicy,
  Topology,
} from "@zephytiju/meridian-storage-constructs";

export interface SecretKeyReference {
  readonly name: string;
  readonly key: string;
}

export interface SecretFileReference {
  readonly name: string;
  readonly items: Readonly<Record<string, string>>;
  readonly mountPath: string;
}

export interface ConfigFileReference {
  readonly name: string;
  readonly items: Readonly<Record<string, string>>;
  readonly mountPath: string;
}

export type RuntimeFileReference =
  | ({ readonly kind: "configMap" } & ConfigFileReference)
  | ({ readonly kind: "secret" } & SecretFileReference);

/** A separately composed runtime for explicit application-owned references. */
export interface OwnedReferenceRuntimeInput {
  readonly configuration: ConfigFileReference;
  readonly runtimeReferences?: readonly RuntimeFileReference[];
}

export interface AdoptionRule {
  readonly aliases?: readonly pulumi.Alias[];
  readonly import?: string;
  readonly protect?: boolean;
  readonly retainOnDelete?: boolean;
}

export type AdoptionMap = Readonly<Record<string, AdoptionRule>>;

export interface LegacyAdoptionCompatibility {
  readonly profile: "core-v1.9.0-uid-preserving";
  readonly retainedThrough: "task-08-verification";
}

export interface GatewayInputs {
  readonly gatewayClassName?: "juntai-platform";
  readonly serviceType?: "ClusterIP" | "LoadBalancer";
  readonly addresses?: Readonly<
    Partial<Record<"internal" | "operator" | "platform" | "public", string>>
  >;
  readonly tlsSecrets?: Readonly<
    Partial<Record<"operator" | "platform" | "public", string>>
  >;
}

export interface ObservabilityInputs {
  readonly exportEndpoint: string;
  readonly authorization?: SecretKeyReference;
  readonly certificateAuthority?: SecretFileReference;
  readonly receiverTls?: SecretFileReference;
  readonly replicas?: number;
}

export interface MeridianEngineSelection {
  readonly bindingId: string;
  readonly profileId:
    | "apache-kafka"
    | "apache-kafka-test"
    | "aws-s3"
    | "clickhouse-replicated"
    | "clickhouse-standalone"
    | "oci-distribution"
    | "opensearch"
    | "postgresql-postgis-cluster"
    | "postgresql-postgis-local-single-primary"
    | "s3-compatible"
    | "valkey-sentinel"
    | "valkey-standalone";
  readonly requiredCapabilityFingerprint: `sha256:${string}`;
  /** Exact public Adapter manifest for the selected runtime; never a merged capability recipe. */
  readonly capabilityManifest?: JsonObject;
  readonly requiredPhysicalFingerprint: `sha256:${string}`;
  readonly settings?: JsonObject;
  readonly physicalNamespace: string;
  readonly identityRef: OpaqueIdentityRef;
  readonly secretRef: OpaqueSecretRef;
  readonly tls: TlsPolicy;
  readonly endpoint?: string;
  readonly serviceRef?: string;
  readonly topology?: Topology;
  readonly engineVersion?: string;
  readonly acl: AclPolicyRef;
  readonly migration: MigrationStateV1;
  readonly observability: ObservabilityBindingV1;
  readonly recovery?: RecoveryCapabilityV1;
}

export interface MeridianInputs {
  readonly engines: readonly MeridianEngineSelection[];
  /** Foundations-owned immutable selection; defaults to the package's released runtime. */
  readonly distribution?: VerifiedArtifact;
  /** Platform-owned per-domain selections; omitted domains retain the default distribution. */
  readonly domainRuntimeSelections?: Readonly<
    Record<string, DomainRuntimeSelection>
  >;
  readonly runtimeReferences?: readonly RuntimeFileReference[];
  /** Domain packages supply logical requirements; Foundations selects physical bindings. */
  readonly domains?: readonly DomainMeridianRequirements[];
  /** Foundations-selected shared logical Resources; domains reference these without taking ownership. */
  readonly sharedResourceStores?: readonly SharedResourceStoreRequirements[];
}

/** Physical choices belong to the Platform composition, separately from logical domain requirements. */
export interface DomainRuntimeSelection {
  readonly distribution: VerifiedArtifact;
  readonly engines: readonly MeridianEngineSelection[];
  readonly runtimeReferences: readonly RuntimeFileReference[];
  readonly metadataBindingId?: string;
}

export interface DomainSchemaProviderPin {
  readonly id: string;
  readonly package: string;
  readonly contract: string;
  readonly version: string;
  readonly requiredFingerprint: `sha256:${string}`;
}

export interface DomainMeridianRequirements {
  readonly id: string;
  readonly ownerPackage: `juntai.platform.domain.${string}`;
  readonly resourceNamespace: string;
  readonly schemaProviders: readonly DomainSchemaProviderPin[];
  readonly resources: readonly MeridianResourceRequirementV1[];
  /** An exact provider release owns a logical namespace that does not use the legacy owner-dot convention. */
  readonly namespaceOwnership?: DomainNamespaceOwnership;
  readonly resourceStoreDependencies?: readonly DomainResourceStoreDependency[];
}

export interface DomainNamespaceOwnership {
  readonly namespace: string;
  readonly provider: DomainSchemaProviderPin;
}

/** Closed Configuration/Artifact plugin contract, selected by Foundations. No Engine inputs are accepted here. */
export interface SharedResourceStoreRequirements {
  readonly id: string;
  readonly kind: "configuration-artifact";
  readonly provider: DomainSchemaProviderPin;
  readonly resources: readonly MeridianResourceRequirementV1[];
}

export interface DomainResourceStoreDependency {
  readonly storeId: string;
  readonly kind: "configuration-artifact";
  readonly provider: DomainSchemaProviderPin;
  readonly resourceFingerprints: readonly {
    readonly selector: ResourceSelectorV1;
    readonly requiredFingerprint: `sha256:${string}`;
  }[];
}

export interface CasdoorInputs {
  readonly configuration: SecretFileReference;
  readonly bootstrapCredential: SecretKeyReference;
  readonly consoleRedirectUri: string;
  readonly reconciliationSchedule?: string;
}

export interface BlueprintInputs {
  readonly ownedReferenceRuntime?: OwnedReferenceRuntimeInput;
  readonly enabled?: boolean;
  readonly casdoorIssuer: string;
  readonly casdoorAudience: string;
  readonly casdoorPolicyEnforcerId: `${string}/${string}`;
  readonly casdoorPolicyClientId: string;
  readonly cursorHmac: SecretFileReference;
  readonly policyReaderClientSecret: SecretFileReference;
  readonly replicas?: number;
}

export interface AccountInputs {
  readonly enabled?: boolean;
  readonly composition: ConfigFileReference;
  readonly compositionFactory: `${string}:${string}`;
  readonly runtimeReferences?: readonly RuntimeFileReference[];
  readonly replicas?: number;
}

export interface ApplicationMetadataWorkloadBinding {
  readonly namespace: string;
  readonly serviceAccount: string;
  readonly tenantId: string;
  readonly workloadId: string;
}

export interface ApplicationMetadataInputs {
  readonly ownedReferenceRuntime?: OwnedReferenceRuntimeInput;
  readonly enabled?: boolean;
  readonly casdoorIssuer: string;
  readonly casdoorAudience: string;
  readonly casdoorPolicyEnforcerId: `${string}/${string}`;
  readonly casdoorServiceClientId: string;
  readonly cursorHmac: SecretFileReference;
  readonly policyReaderClientSecret: SecretFileReference;
  readonly kubernetesApiServer?: string;
  readonly kubernetesApiCidr: string;
  readonly kubernetesWorkloadAudience: string;
  readonly kubernetesWorkloadIssuer: string;
  readonly workloadBindings: readonly ApplicationMetadataWorkloadBinding[];
  readonly replicas?: number;
}

export interface FoundationsInputs extends Readonly<Record<string, unknown>> {
  readonly serviceConsumers?: readonly FoundationServiceConsumer[];
  readonly account: AccountInputs;
  readonly adoption?: AdoptionMap;
  readonly applicationMetadata: ApplicationMetadataInputs;
  readonly blueprint: BlueprintInputs;
  readonly casdoor: CasdoorInputs;
  readonly gateway: GatewayInputs;
  readonly legacyAdoptionCompatibility?: LegacyAdoptionCompatibility;
  readonly meridian: MeridianInputs;
  readonly observability: ObservabilityInputs;
}

export interface FoundationsProviders extends Readonly<
  Record<string, unknown>
> {
  readonly kubernetes: k8s.Provider;
}

export interface GatewaySetOutput {
  /** Envoy's standard controller namespace mode; distinct from Gateway object ownership. */
  readonly dataPlaneNamespace?: pulumi.Output<string>;
  readonly gatewayClassName: pulumi.Output<string>;
  readonly gateways: Readonly<
    Record<
      "internal" | "operator" | "platform" | "public",
      pulumi.Output<string>
    >
  >;
  readonly namespace: pulumi.Output<string>;
}

export interface MeridianRuntimeOutput {
  readonly distribution: MeridianRuntimeDistributionOutput;
  readonly runtimeReferences: readonly RuntimeFileReference[];
  readonly configFingerprint: pulumi.Output<string>;
  readonly configMapName: pulumi.Output<string>;
  readonly namespace: pulumi.Output<string>;
  readonly resourceBindings: pulumi.Output<Readonly<Record<string, unknown>>>;
  readonly domainRuntimes?: Readonly<
    Record<string, DomainMeridianRuntimeOutput>
  >;
}

export interface MeridianRuntimeDistributionOutput {
  readonly selection: VerifiedArtifact;
  readonly descriptor: RuntimeDistributionDescriptor;
  readonly configMapName: pulumi.Output<string>;
  readonly namespace: pulumi.Output<string>;
  readonly key: "runtime-distribution.v1.json";
  readonly mountPath: "/etc/juntai/meridian-distribution";
  readonly descriptorDigest: `sha256:${string}`;
}

export interface DomainMeridianRuntimeOutput {
  readonly distribution: MeridianRuntimeDistributionOutput;
  readonly metadataBindingId?: string;
  /** Opaque physical pin used to require the same metadata store across consumers. */
  readonly metadataBindingFingerprint?: string;
  readonly runtimeReferences: readonly RuntimeFileReference[];
  readonly ownerPackage: string;
  readonly resourceNamespace: string;
  readonly requirementsFingerprint: string;
  readonly configFingerprint: pulumi.Output<string>;
  readonly configMapName: pulumi.Output<string>;
  readonly namespace: pulumi.Output<string>;
  readonly resourceBindings: pulumi.Output<Readonly<Record<string, unknown>>>;
}

export interface FoundationsServiceOutput {
  readonly endpoint: pulumi.Output<string>;
  readonly gatewaySurface: "internal" | "operator" | "platform" | "public";
  readonly imageDigest: `sha256:${string}`;
  readonly namespace: pulumi.Output<string>;
  readonly observabilityServiceName: string;
  readonly readinessPath: `/${string}`;
  readonly recovery: string;
  readonly releaseVersion: string;
  readonly routePrefix: `/${string}`;
  readonly serviceId: string;
  readonly serviceName: pulumi.Output<string>;
}

export interface FoundationServicesOutput {
  readonly consumers?: readonly FoundationServiceConsumer[];
  readonly account?: FoundationsServiceOutput;
  readonly applicationMetadata?: FoundationsServiceOutput;
  readonly blueprint?: FoundationsServiceOutput;
  readonly casdoor: FoundationsServiceOutput;
}

export interface FoundationServiceConsumer {
  readonly namespace: string;
  readonly workloadName: string;
  readonly service: "application-metadata" | "blueprint";
}

export interface ObservabilityGatewayOutput {
  readonly endpoint: pulumi.Output<string>;
  readonly namespace: pulumi.Output<string>;
}

export interface FoundationsOutputs extends Readonly<Record<string, unknown>> {
  readonly contractComposition: ContractCompositionEvidence;
  readonly foundationServices: FoundationServicesOutput;
  readonly gatewaySet: GatewaySetOutput;
  readonly meridianRuntime: MeridianRuntimeOutput;
  readonly observabilityGateway: ObservabilityGatewayOutput;
}
