import type * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import type { ContractCompositionEvidence } from "./contract-composition.js";
import type {
  AclPolicyRef,
  JsonObject,
  MigrationStateV1,
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
}

export interface CasdoorInputs {
  readonly configuration: SecretFileReference;
  readonly bootstrapCredential: SecretKeyReference;
  readonly consoleRedirectUri: string;
  readonly reconciliationSchedule?: string;
}

export interface BlueprintInputs {
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
  readonly account?: FoundationsServiceOutput;
  readonly applicationMetadata?: FoundationsServiceOutput;
  readonly blueprint?: FoundationsServiceOutput;
  readonly casdoor: FoundationsServiceOutput;
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
