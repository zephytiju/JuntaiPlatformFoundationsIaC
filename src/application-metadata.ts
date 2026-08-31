import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import {
  GatewayBinding,
  JuntaiService,
  ObservabilityBinding,
  RuntimeReferences,
  WorkloadIdentity,
  literalValue,
} from "@zephytiju/juntai-platform-constructs";
import type { MeridianRuntimeConfig } from "@zephytiju/juntai-platform-constructs";
import { adoptionOptions, childMigration } from "./adoption.js";
import type { ContractRouteInput } from "./contract-composition.js";
import {
  projectWorkloadTokens,
  rewriteGatewayPrefix,
} from "./resource-transformations.js";
import { APPLICATION_METADATA_IMAGE } from "./release.js";
import { serviceDeclaration } from "./service-contracts.js";
import type {
  AdoptionMap,
  ApplicationMetadataInputs,
  FoundationsServiceOutput,
  GatewaySetOutput,
  ObservabilityGatewayOutput,
} from "./types.js";

const declaration = serviceDeclaration("platform.application-metadata");

function workloadBindings(inputs: ApplicationMetadataInputs): string {
  const bindings = [...inputs.workloadBindings].sort((left, right) =>
    [left.namespace, left.serviceAccount, left.tenantId, left.workloadId]
      .join("\0")
      .localeCompare(
        [
          right.namespace,
          right.serviceAccount,
          right.tenantId,
          right.workloadId,
        ].join("\0"),
      ),
  );
  return JSON.stringify({
    schema: "juntai.application-metadata-workload-bindings/v1",
    bindings,
  });
}

export function createApplicationMetadata(args: {
  readonly provider: k8s.Provider;
  readonly namespace: pulumi.Input<string>;
  readonly stage: string;
  readonly inputs: ApplicationMetadataInputs;
  readonly gatewaySet: GatewaySetOutput;
  readonly casdoor: FoundationsServiceOutput;
  readonly meridianRuntime: MeridianRuntimeConfig;
  readonly observability: ObservabilityGatewayOutput;
  readonly adoption?: AdoptionMap;
  readonly route?: ContractRouteInput;
}): FoundationsServiceOutput | undefined {
  if (args.inputs.enabled === false) return undefined;
  if (args.route === undefined) {
    throw new Error(
      "Application Metadata deployment requires a verified contract route",
    );
  }
  const identity = new WorkloadIdentity("application-metadata", {
    namespace: args.namespace,
    provider: args.provider,
    resourceMigration: {
      serviceAccount: childMigration(
        args.adoption,
        "application-metadata/identity",
      ),
    },
  });
  const tokenReviewRole = new k8s.rbac.v1.ClusterRole(
    "application-metadata-token-reviewer",
    {
      metadata: {
        name: "juntai-application-metadata-token-reviewer",
        labels: {
          "app.kubernetes.io/managed-by": "juntai-platform-foundations-iac",
        },
      },
      rules: [
        {
          apiGroups: ["authentication.k8s.io"],
          resources: ["tokenreviews"],
          verbs: ["create"],
        },
      ],
    },
    {
      provider: args.provider,
      ...adoptionOptions(
        args.adoption,
        "application-metadata/identity/token-review-role",
      ),
    },
  );
  new k8s.rbac.v1.ClusterRoleBinding(
    "application-metadata-token-reviewer",
    {
      metadata: {
        name: "juntai-application-metadata-token-reviewer",
        labels: {
          "app.kubernetes.io/managed-by": "juntai-platform-foundations-iac",
        },
      },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: tokenReviewRole.metadata.name,
      },
      subjects: [
        {
          apiGroup: "",
          kind: "ServiceAccount",
          namespace: identity.serviceAccount.metadata.namespace,
          name: identity.serviceAccount.metadata.name,
        },
      ],
    },
    {
      provider: args.provider,
      ...adoptionOptions(
        args.adoption,
        "application-metadata/identity/token-review-binding",
      ),
    },
  );
  const runtimeConfig = new k8s.core.v1.ConfigMap(
    "application-metadata-runtime",
    {
      metadata: {
        namespace: args.namespace,
        name: "application-metadata-runtime",
        labels: {
          "app.kubernetes.io/managed-by": "juntai-platform-foundations-iac",
        },
      },
      data: {
        "bindings.json": workloadBindings(args.inputs),
        "meridian-config.v1.json": args.meridianRuntime.configMap.data.apply(
          (data) => data?.["meridian-config.v1.json"] ?? "",
        ),
      },
    },
    {
      provider: args.provider,
      ...adoptionOptions(args.adoption, "application-metadata/runtime-config"),
    },
  );
  const observability = new ObservabilityBinding("application-metadata", {
    serviceName: "platform-application-metadata",
    endpoint: args.observability.endpoint,
    protocol: "grpc",
    resourceAttributes: {
      "deployment.environment": args.stage,
      "service.namespace": "platform",
    },
  });
  const references = new RuntimeReferences("application-metadata", {
    environment: [
      literalValue(
        "APPLICATION_METADATA_CURSOR_SECRET_FILE",
        `${args.inputs.cursorHmac.mountPath}/${args.inputs.cursorHmac.items["hmac-key"]}`,
      ),
      literalValue(
        "CASDOOR_SERVICE_CLIENT_SECRET_FILE",
        `${args.inputs.policyReaderClientSecret.mountPath}/${args.inputs.policyReaderClientSecret.items["client-secret"]}`,
      ),
      literalValue(
        "APPLICATION_METADATA_WORKLOAD_BINDINGS_FILE",
        "/etc/juntai/application-metadata/workload-bindings.json",
      ),
      literalValue(
        "MERIDIAN_CONFIG",
        "/etc/juntai/application-metadata/meridian-config.v1.json",
      ),
      literalValue("CASDOOR_ISSUER", args.inputs.casdoorIssuer),
      literalValue("CASDOOR_AUDIENCE", args.inputs.casdoorAudience),
      literalValue(
        "CASDOOR_POLICY_ENFORCER_ID",
        args.inputs.casdoorPolicyEnforcerId,
      ),
      literalValue(
        "CASDOOR_SERVICE_CLIENT_ID",
        args.inputs.casdoorServiceClientId,
      ),
      literalValue("CASDOOR_ALLOW_HTTP", "1"),
      literalValue("CASDOOR_TENANT_CLAIM", "tenant_id"),
      literalValue("JUNTAI_CAPABILITY_IAM_ENDPOINT", args.casdoor.endpoint),
      literalValue(
        "JUNTAI_CAPABILITY_OBSERVABILITY_ENDPOINT",
        args.observability.endpoint,
      ),
      literalValue(
        "KUBERNETES_API_SERVER",
        args.inputs.kubernetesApiServer ?? "https://kubernetes.default.svc",
      ),
      literalValue(
        "KUBERNETES_WORKLOAD_AUDIENCE",
        args.inputs.kubernetesWorkloadAudience,
      ),
      literalValue(
        "KUBERNETES_WORKLOAD_ISSUER",
        args.inputs.kubernetesWorkloadIssuer,
      ),
      literalValue("IAM_WORKLOAD_TOKEN_FILE", "/var/run/secrets/juntai/token"),
      literalValue(
        "KUBERNETES_TOKEN_REVIEW_TOKEN_FILE",
        "/var/run/secrets/juntai/token-reviewer",
      ),
      literalValue(
        "KUBERNETES_CA_FILE",
        "/var/run/secrets/juntai/kube-root-ca.crt",
      ),
      literalValue("JUNTAI_ENVIRONMENT", args.stage),
    ],
    files: [
      {
        kind: "configMap",
        name: runtimeConfig.metadata.name,
        mountPath: "/etc/juntai/application-metadata",
        items: {
          "bindings.json": "workload-bindings.json",
          "meridian-config.v1.json": "meridian-config.v1.json",
        },
        readOnly: true,
      },
      { kind: "secret", ...args.inputs.cursorHmac, readOnly: true },
      {
        kind: "secret",
        ...args.inputs.policyReaderClientSecret,
        readOnly: true,
      },
    ],
  });
  const service = new JuntaiService(
    "application-metadata",
    {
      namespace: args.namespace,
      provider: args.provider,
      identity: identity.reference,
      image: APPLICATION_METADATA_IMAGE,
      port: 8080,
      replicas: args.inputs.replicas ?? 2,
      autoscaling: {
        minReplicas: args.inputs.replicas ?? 2,
        maxReplicas: 8,
        targetCpuUtilizationPercentage: 70,
      },
      references,
      observability,
      resources: {
        requests: { cpu: "100m", memory: "128Mi" },
        limits: { cpu: "1", memory: "512Mi" },
      },
      probes: {
        startup: {
          path: "/health/startup",
          port: 8080,
          periodSeconds: 2,
          failureThreshold: 60,
        },
        readiness: { path: "/health/ready", port: 8080 },
        liveness: { path: "/health/live", port: 8080 },
      },
      networkPolicy: {
        allowClusterDns: true,
        ingress: [
          {
            peers: [
              {
                namespaceLabels: {
                  "kubernetes.io/metadata.name": "juntai-gateway",
                },
              },
            ],
            ports: [{ port: 8080 }],
          },
        ],
        egress: [
          {
            peers: [
              {
                namespaceLabels: {
                  "kubernetes.io/metadata.name": "juntai-capabilities",
                },
              },
              {
                namespaceLabels: {
                  "kubernetes.io/metadata.name": "juntai-iam",
                },
              },
              {
                namespaceLabels: {
                  "kubernetes.io/metadata.name": "juntai-observability",
                },
              },
            ],
          },
          {
            peers: [{ cidr: args.inputs.kubernetesApiCidr }],
            ports: [{ port: 443 }],
          },
        ],
      },
      resourceMigration: {
        workload: {
          deployment: childMigration(
            args.adoption,
            "application-metadata/deployment",
          ),
          disruptionBudget: childMigration(
            args.adoption,
            "application-metadata/pdb",
          ),
          autoscaler: childMigration(args.adoption, "application-metadata/hpa"),
        },
        service: childMigration(args.adoption, "application-metadata/service"),
        networkPolicy: {
          defaultDeny: childMigration(
            args.adoption,
            "application-metadata/network/default-deny",
          ),
          allowedTraffic: childMigration(
            args.adoption,
            "application-metadata/network/allowed",
          ),
        },
      },
    },
    {
      transformations: [
        projectWorkloadTokens({
          workloadAudience: args.inputs.kubernetesWorkloadAudience,
          tokenReviewAudience:
            args.inputs.kubernetesApiServer ?? "https://kubernetes.default.svc",
        }),
      ],
    },
  );
  new GatewayBinding(
    "application-metadata",
    {
      namespace: args.namespace,
      provider: args.provider,
      gateway: {
        namespace: args.gatewaySet.namespace,
        name: args.gatewaySet.gateways.platform,
      },
      service: { name: service.service.metadata.name, port: 8080 },
      pathPrefix: args.route.pathPrefix,
      resourceMigration: childMigration(
        args.adoption,
        "application-metadata/route",
      ),
    },
    { transformations: [rewriteGatewayPrefix("/v1")] },
  );
  return Object.freeze({
    endpoint: service.internalEndpoint,
    gatewaySurface: "platform",
    imageDigest: declaration.release.imageDigest,
    namespace: service.service.metadata.namespace,
    observabilityServiceName: "platform-application-metadata",
    readinessPath: "/health/ready",
    recovery: declaration.deployment.recovery,
    releaseVersion: declaration.release.version,
    routePrefix: args.route.pathPrefix,
    serviceId: declaration.id,
    serviceName: service.service.metadata.name,
  });
}
