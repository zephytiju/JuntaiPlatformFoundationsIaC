import type * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import {
  GatewayBinding,
  JuntaiService,
  ObservabilityBinding,
  RuntimeReferences,
  WorkloadIdentity,
  literalValue,
} from "@zephytiju/juntai-platform-constructs";
import { childMigration } from "./adoption.js";
import { verifyBlueprintOpenApi, type ArtifactFetcher } from "./artifacts.js";
import { BLUEPRINT_IMAGE, BLUEPRINT_OPENAPI } from "./release.js";
import type {
  AdoptionMap,
  BlueprintInputs,
  FoundationsServiceOutput,
  GatewaySetOutput,
  ObservabilityGatewayOutput,
} from "./types.js";
import type { MeridianRuntimeConfig } from "@zephytiju/juntai-platform-constructs";

function secretFile(reference: BlueprintInputs["cursorHmac"]): {
  readonly kind: "secret";
  readonly name: string;
  readonly items: Readonly<Record<string, string>>;
  readonly mountPath: string;
  readonly readOnly: true;
} {
  return { kind: "secret", ...reference, readOnly: true };
}

export async function createBlueprint(args: {
  readonly provider: k8s.Provider;
  readonly namespace: pulumi.Input<string>;
  readonly inputs: BlueprintInputs;
  readonly gatewaySet: GatewaySetOutput;
  readonly meridianRuntime: MeridianRuntimeConfig;
  readonly observability: ObservabilityGatewayOutput;
  readonly adoption?: AdoptionMap;
  readonly fetcher?: ArtifactFetcher;
}): Promise<FoundationsServiceOutput | undefined> {
  if (args.inputs.enabled === false) return undefined;
  await verifyBlueprintOpenApi(BLUEPRINT_OPENAPI, args.fetcher);
  const identity = new WorkloadIdentity("blueprint", {
    namespace: args.namespace,
    provider: args.provider,
    resourceMigration: {
      serviceAccount: childMigration(args.adoption, "blueprint/identity"),
    },
  });
  const observability = new ObservabilityBinding("blueprint", {
    serviceName: "platform-blueprint",
    endpoint: args.observability.endpoint,
    protocol: "grpc",
    resourceAttributes: {
      "deployment.environment": "juntai-platform",
      "service.namespace": "platform",
    },
  });
  const references = new RuntimeReferences("blueprint", {
    environment: [
      literalValue(
        "MERIDIAN_CONFIG",
        "/etc/juntai/meridian/meridian-config.v1.json",
      ),
      literalValue(
        "CURSOR_HMAC_SECRET_FILE",
        `${args.inputs.cursorHmac.mountPath}/hmac-key`,
      ),
      literalValue(
        "CASDOOR_POLICY_CLIENT_SECRET_FILE",
        `${args.inputs.policyReaderClientSecret.mountPath}/client-secret`,
      ),
    ],
    files: [
      {
        kind: "configMap",
        name: args.meridianRuntime.configMap.metadata.name,
        mountPath: "/etc/juntai/meridian",
        items: {
          "meridian-config.v1.json": "meridian-config.v1.json",
        },
        readOnly: true,
      },
      secretFile(args.inputs.cursorHmac),
      secretFile(args.inputs.policyReaderClientSecret),
    ],
  });
  const service = new JuntaiService("blueprint", {
    namespace: args.namespace,
    provider: args.provider,
    identity: identity.reference,
    image: BLUEPRINT_IMAGE,
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
      ],
    },
    resourceMigration: {
      workload: {
        deployment: childMigration(args.adoption, "blueprint/deployment"),
        disruptionBudget: childMigration(args.adoption, "blueprint/pdb"),
        autoscaler: childMigration(args.adoption, "blueprint/hpa"),
      },
      service: childMigration(args.adoption, "blueprint/service"),
      networkPolicy: {
        defaultDeny: childMigration(
          args.adoption,
          "blueprint/network/default-deny",
        ),
        allowedTraffic: childMigration(
          args.adoption,
          "blueprint/network/allowed",
        ),
      },
    },
  });
  new GatewayBinding("blueprint", {
    namespace: args.namespace,
    provider: args.provider,
    gateway: {
      namespace: args.gatewaySet.namespace,
      name: args.gatewaySet.gateways.platform,
    },
    service: { name: service.service.metadata.name, port: 8080 },
    pathPrefix: "/api/blueprints/v1",
    resourceMigration: childMigration(args.adoption, "blueprint/route"),
  });
  return Object.freeze({
    endpoint: service.internalEndpoint,
    namespace: service.service.metadata.namespace,
    serviceName: service.service.metadata.name,
  });
}
