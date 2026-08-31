import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import {
  CasdoorService,
  JuntaiJob,
  RuntimeReferences,
  ScheduledOperation,
  WorkloadIdentity,
  secretValue,
} from "@zephytiju/juntai-platform-constructs";
import { adoptionOptions, childMigration } from "./adoption.js";
import { sha256 } from "./artifacts.js";
import { CASDOOR_BOOTSTRAP_IMAGE, CASDOOR_IMAGE } from "./release.js";
import { serviceDeclaration } from "./service-contracts.js";
import type {
  AdoptionMap,
  CasdoorInputs,
  FoundationsServiceOutput,
  GatewaySetOutput,
} from "./types.js";

const declaration = serviceDeclaration("foundation.iam");

interface CasdoorDesiredObject {
  readonly kind:
    "adapter" | "application" | "enforcer" | "model" | "organization";
  readonly owner: "admin";
  readonly name: string;
  readonly managedFields: readonly string[];
  readonly ownershipField: string;
  readonly ownershipValue: string | readonly string[];
  readonly body: Readonly<Record<string, unknown>>;
}

export interface CasdoorDesiredState {
  readonly schemaVersion: "juntai.platform/casdoor-bootstrap/v1";
  readonly managementTag: string;
  readonly iamContract: {
    readonly package: "juntai-iam-contracts";
    readonly version: "1.1.1";
    readonly manifestSha256: string;
  };
  readonly objects: readonly CasdoorDesiredObject[];
}

export function casdoorDesiredState(
  stage: string,
  consoleRedirectUri: string,
): CasdoorDesiredState {
  const managementTag = `juntai-platform-${stage}`;
  const managed = (value: string | readonly string[]) => value;
  const state: CasdoorDesiredState = {
    schemaVersion: "juntai.platform/casdoor-bootstrap/v1",
    managementTag,
    iamContract: {
      package: "juntai-iam-contracts",
      version: "1.1.1",
      manifestSha256:
        "64dafb25c54d40320347c8661960d23ba524a2d3c102d112c08c95679d12db85",
    },
    // Deliberately no client_credentials Application. That subject remains
    // gated until the approved Casdoor/IAM contract release supports it.
    objects: [
      {
        kind: "organization",
        owner: "admin",
        name: "juntai-system",
        managedFields: ["displayName", "tags"],
        ownershipField: "tags",
        ownershipValue: managed([managementTag]),
        body: {
          owner: "admin",
          name: "juntai-system",
          displayName: "Juntai System",
          tags: [managementTag],
        },
      },
      {
        kind: "application",
        owner: "admin",
        name: "juntai-console",
        managedFields: [
          "displayName",
          "organization",
          "redirectUris",
          "tokenFormat",
          "tags",
        ],
        ownershipField: "tags",
        ownershipValue: managed([managementTag]),
        body: {
          owner: "admin",
          name: "juntai-console",
          displayName: "Juntai Console",
          organization: "juntai-system",
          redirectUris: [consoleRedirectUri],
          tokenFormat: "JWT",
          tags: [managementTag],
        },
      },
      {
        kind: "model",
        owner: "admin",
        name: "juntai-domain-authorization",
        managedFields: ["displayName", "description", "modelText"],
        ownershipField: "description",
        ownershipValue: managementTag,
        body: {
          owner: "admin",
          name: "juntai-domain-authorization",
          displayName: "Juntai domain authorization",
          description: managementTag,
          modelText:
            "[request_definition]\nr = sub, tenant, obj, act, field\n[policy_definition]\np = sub, tenant, obj, act, field, eft\n[role_definition]\ng = _, _, _\n[policy_effect]\ne = !some(where (p.eft == deny)) && some(where (p.eft == allow))\n[matchers]\nm = g(r.sub, p.sub, r.tenant) && r.tenant == p.tenant && keyMatch2(r.obj, p.obj) && keyMatch2(r.act, p.act) && keyMatch2(r.field, p.field)",
        },
      },
      {
        kind: "adapter",
        owner: "admin",
        name: "juntai-domain-authorization",
        managedFields: ["table", "useSameDb", "type"],
        ownershipField: "table",
        ownershipValue: "juntai_policy_rule",
        body: {
          owner: "admin",
          name: "juntai-domain-authorization",
          table: "juntai_policy_rule",
          useSameDb: true,
          type: "Database",
        },
      },
      {
        kind: "enforcer",
        owner: "admin",
        name: "juntai-domain-authorization",
        managedFields: ["displayName", "description", "model", "adapter"],
        ownershipField: "description",
        ownershipValue: managementTag,
        body: {
          owner: "admin",
          name: "juntai-domain-authorization",
          displayName: "Juntai domain authorization",
          description: managementTag,
          model: "admin/juntai-domain-authorization",
          adapter: "admin/juntai-domain-authorization",
        },
      },
    ],
  };
  return Object.freeze(state);
}

function routeOptions(
  provider: k8s.Provider,
  adoption: AdoptionMap | undefined,
  key: string,
): pulumi.CustomResourceOptions {
  return { provider, ...adoptionOptions(adoption, key) };
}

function createRoutes(args: {
  readonly provider: k8s.Provider;
  readonly namespace: pulumi.Input<string>;
  readonly serviceName: pulumi.Input<string>;
  readonly gatewaySet: GatewaySetOutput;
  readonly adoption?: AdoptionMap;
}): void {
  const backendRefs = [
    {
      group: "",
      kind: "Service",
      name: args.serviceName,
      port: 8000,
      weight: 1,
    },
  ];
  const metadata = (name: string) => ({
    name,
    namespace: args.namespace,
    labels: {
      "app.kubernetes.io/managed-by": "juntai-platform-foundations-iac",
      "juntai.dev/backend-trust": "casdoor-unmodified",
    },
  });
  const parentRef = (gateway: pulumi.Output<string>) => [
    {
      group: "gateway.networking.k8s.io",
      kind: "Gateway",
      namespace: args.gatewaySet.namespace,
      name: gateway,
    },
  ];
  new k8s.apiextensions.CustomResource(
    "casdoor-public-oauth-route",
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: metadata("casdoor-oauth"),
      spec: {
        parentRefs: parentRef(args.gatewaySet.gateways.public),
        rules: [
          {
            matches: [
              ["GET", "/.well-known/openid-configuration"],
              ["GET", "/.well-known/jwks"],
              ["POST", "/api/login/oauth/access_token"],
              ["GET", "/api/userinfo"],
              ["GET", "/login/oauth/authorize"],
            ].map(([method, value]) => ({
              method,
              path: { type: "Exact", value },
            })),
            backendRefs,
          },
        ],
      },
    },
    routeOptions(args.provider, args.adoption, "casdoor/route/public-oauth"),
  );
  new k8s.apiextensions.CustomResource(
    "casdoor-operator-route",
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: metadata("casdoor-operator"),
      spec: {
        parentRefs: parentRef(args.gatewaySet.gateways.operator),
        rules: [
          {
            matches: [{ path: { type: "PathPrefix", value: "/" } }],
            backendRefs,
          },
        ],
      },
    },
    routeOptions(args.provider, args.adoption, "casdoor/route/operator"),
  );
  new k8s.apiextensions.CustomResource(
    "casdoor-policy-reader-route",
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: metadata("casdoor-policy-reader"),
      spec: {
        parentRefs: parentRef(args.gatewaySet.gateways.internal),
        rules: [
          {
            matches: [
              {
                method: "POST",
                path: { type: "Exact", value: "/api/get-filtered-policies" },
              },
            ],
            backendRefs,
          },
        ],
      },
    },
    routeOptions(args.provider, args.adoption, "casdoor/route/policy-reader"),
  );
}

export function createCasdoor(args: {
  readonly provider: k8s.Provider;
  readonly namespace: pulumi.Input<string>;
  readonly stage: string;
  readonly inputs: CasdoorInputs;
  readonly gatewaySet: GatewaySetOutput;
  readonly adoption?: AdoptionMap;
}): FoundationsServiceOutput {
  const identity = new WorkloadIdentity("casdoor", {
    namespace: args.namespace,
    provider: args.provider,
    resourceMigration: {
      serviceAccount: childMigration(args.adoption, "casdoor/identity"),
    },
  });
  const serviceReferences = new RuntimeReferences("casdoor", {
    files: [
      {
        kind: "secret",
        ...args.inputs.configuration,
        readOnly: true,
      },
    ],
  });
  const service = new CasdoorService("casdoor", {
    namespace: args.namespace,
    provider: args.provider,
    identity: identity.reference,
    image: CASDOOR_IMAGE,
    port: 8000,
    replicas: 2,
    references: serviceReferences,
    resources: {
      requests: { cpu: "100m", memory: "256Mi" },
      limits: { cpu: "1", memory: "1Gi" },
    },
    probes: {
      startup: {
        path: "/api/health",
        port: 8000,
        periodSeconds: 3,
        failureThreshold: 40,
      },
      readiness: { path: "/api/health", port: 8000, periodSeconds: 5 },
      liveness: { path: "/api/health", port: 8000, periodSeconds: 10 },
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
            { podLabels: { "juntai.dev/bootstrap": "casdoor" } },
          ],
          ports: [{ port: 8000 }],
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
          ],
        },
      ],
    },
    resourceMigration: {
      workload: {
        deployment: childMigration(args.adoption, "casdoor/deployment"),
        disruptionBudget: childMigration(args.adoption, "casdoor/pdb"),
      },
      service: childMigration(args.adoption, "casdoor/service"),
      networkPolicy: {
        defaultDeny: childMigration(
          args.adoption,
          "casdoor/network/default-deny",
        ),
        allowedTraffic: childMigration(
          args.adoption,
          "casdoor/network/allowed",
        ),
      },
    },
  });
  const desiredState = casdoorDesiredState(
    args.stage,
    args.inputs.consoleRedirectUri,
  );
  const desiredStateJson = `${JSON.stringify(desiredState, null, 2)}\n`;
  const desiredStateDigest = sha256(desiredStateJson).slice(7, 23);
  const desiredStateMap = new k8s.core.v1.ConfigMap(
    "casdoor-desired-state",
    {
      metadata: {
        namespace: args.namespace,
        name: `casdoor-bootstrap-${desiredStateDigest}`,
        labels: {
          "app.kubernetes.io/managed-by": "juntai-platform-foundations-iac",
        },
      },
      immutable: true,
      data: { "desired-state.json": desiredStateJson },
    },
    {
      provider: args.provider,
      ...adoptionOptions(args.adoption, "casdoor/desired-state"),
    },
  );
  const bootstrapIdentity = new WorkloadIdentity("casdoor-bootstrap", {
    namespace: args.namespace,
    provider: args.provider,
    resourceMigration: {
      serviceAccount: childMigration(
        args.adoption,
        "casdoor/bootstrap/identity",
      ),
    },
  });
  const bootstrapReferences = new RuntimeReferences("casdoor-bootstrap", {
    environment: [
      secretValue("CASDOOR_BOOTSTRAP_TOKEN", args.inputs.bootstrapCredential),
    ],
    files: [
      {
        kind: "configMap",
        name: desiredStateMap.metadata.name,
        mountPath: "/etc/juntai-casdoor",
        items: { "desired-state.json": "desired-state.json" },
        readOnly: true,
      },
    ],
  });
  const operationArgs = {
    namespace: args.namespace,
    provider: args.provider,
    identity: bootstrapIdentity.reference,
    image: CASDOOR_BOOTSTRAP_IMAGE,
    command: ["node", "/app/dist/platform/bootstrap/casdoor/main.js"],
    environment: [
      { name: "CASDOOR_ENDPOINT", value: service.apiEndpoint },
      {
        name: "CASDOOR_DESIRED_STATE",
        value: "/etc/juntai-casdoor/desired-state.json",
      },
    ],
    references: bootstrapReferences,
    resources: {
      requests: { cpu: "50m", memory: "64Mi" },
      limits: { cpu: "500m", memory: "256Mi" },
    },
    labels: { "juntai.dev/bootstrap": "casdoor" },
  } as const;
  new JuntaiJob("casdoor-bootstrap", {
    ...operationArgs,
    backoffLimit: 3,
    activeDeadlineSeconds: 600,
    ttlSecondsAfterFinished: 86_400,
    resourceMigration: childMigration(args.adoption, "casdoor/bootstrap/job"),
  });
  new ScheduledOperation("casdoor-reconcile", {
    ...operationArgs,
    schedule: args.inputs.reconciliationSchedule ?? "17 3 * * *",
    startingDeadlineSeconds: 900,
    resourceMigration: childMigration(
      args.adoption,
      "casdoor/reconcile/cronjob",
    ),
  });
  createRoutes({
    provider: args.provider,
    namespace: args.namespace,
    serviceName: service.service.service.metadata.name,
    gatewaySet: args.gatewaySet,
    adoption: args.adoption,
  });
  return Object.freeze({
    endpoint: service.apiEndpoint,
    gatewaySurface: "public",
    imageDigest: declaration.release.imageDigest,
    namespace: service.service.service.metadata.namespace,
    observabilityServiceName: "foundation-iam",
    readinessPath: "/api/health",
    recovery: declaration.deployment.recovery,
    releaseVersion: declaration.release.version,
    routePrefix: "/api/identity",
    serviceId: declaration.id,
    serviceName: service.service.service.metadata.name,
  });
}
