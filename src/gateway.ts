import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { adoptionOptions } from "./adoption.js";
import { fetchVerifiedText, type ArtifactFetcher } from "./artifacts.js";
import { ENVOY_GATEWAY_MANIFEST, GATEWAY_API_MANIFEST } from "./release.js";
import type { AdoptionMap, GatewayInputs, GatewaySetOutput } from "./types.js";

const GATEWAY_NAMES = Object.freeze({
  internal: "juntai-internal-gateway",
  operator: "juntai-operator-gateway",
  platform: "juntai-platform",
  public: "juntai-gateway",
} as const);

function listener(
  name: keyof typeof GATEWAY_NAMES,
  tlsSecret: string | undefined,
): Record<string, unknown> {
  const secure = tlsSecret !== undefined;
  return {
    name: secure ? "https" : "http",
    protocol: secure ? "HTTPS" : "HTTP",
    port: secure ? 443 : 80,
    ...(secure
      ? {
          tls: {
            mode: "Terminate",
            certificateRefs: [{ group: "", kind: "Secret", name: tlsSecret }],
          },
        }
      : {}),
    allowedRoutes: {
      namespaces: {
        from: "Selector",
        selector: {
          matchLabels: { "juntai.dev/gateway-route-owner": "true" },
        },
      },
      kinds: [{ group: "gateway.networking.k8s.io", kind: "HTTPRoute" }],
    },
    hostname: name === "internal" ? "*.internal.juntai.local" : undefined,
  };
}

export async function createGatewaySet(args: {
  readonly provider: k8s.Provider;
  readonly namespace: pulumi.Input<string>;
  readonly inputs: GatewayInputs;
  readonly adoption?: AdoptionMap;
  readonly dependsOn?: readonly pulumi.Resource[];
  readonly fetcher?: ArtifactFetcher;
}): Promise<GatewaySetOutput> {
  const gatewayApiYaml = await fetchVerifiedText(
    GATEWAY_API_MANIFEST,
    args.fetcher,
  );
  const envoyGatewayYaml = await fetchVerifiedText(
    ENVOY_GATEWAY_MANIFEST,
    args.fetcher,
  );
  const gatewayApi = new k8s.yaml.ConfigGroup(
    "gateway-api-v1-5-1",
    { yaml: gatewayApiYaml },
    {
      provider: args.provider,
      protect: true,
      dependsOn: args.dependsOn === undefined ? undefined : [...args.dependsOn],
    },
  );
  const envoyGateway = new k8s.yaml.ConfigGroup(
    "envoy-gateway-v1-8-3",
    { yaml: envoyGatewayYaml },
    {
      provider: args.provider,
      protect: true,
      dependsOn: [gatewayApi],
    },
  );
  const gatewayClass = new k8s.apiextensions.CustomResource(
    "juntai-platform-gateway-class",
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "GatewayClass",
      metadata: {
        name: args.inputs.gatewayClassName ?? "juntai-platform",
        labels: {
          "app.kubernetes.io/managed-by": "juntai-platform-foundations-iac",
        },
      },
      spec: { controllerName: "gateway.envoyproxy.io/gatewayclass-controller" },
    },
    {
      provider: args.provider,
      dependsOn: [envoyGateway],
      ...adoptionOptions(args.adoption, "gateway/class/juntai-platform"),
    },
  );
  const gateways = Object.fromEntries(
    (Object.keys(GATEWAY_NAMES) as (keyof typeof GATEWAY_NAMES)[]).map(
      (gateway) => {
        const tlsSecret =
          gateway === "internal"
            ? undefined
            : args.inputs.tlsSecrets?.[gateway];
        const resource = new k8s.apiextensions.CustomResource(
          `gateway-${gateway}`,
          {
            apiVersion: "gateway.networking.k8s.io/v1",
            kind: "Gateway",
            metadata: {
              namespace: args.namespace,
              name: GATEWAY_NAMES[gateway],
              labels: {
                "app.kubernetes.io/managed-by":
                  "juntai-platform-foundations-iac",
                "juntai.dev/gateway-surface": gateway,
              },
            },
            spec: {
              gatewayClassName: gatewayClass.metadata.name,
              ...(args.inputs.addresses?.[gateway] === undefined
                ? {}
                : {
                    addresses: [
                      {
                        type: "IPAddress",
                        value: args.inputs.addresses[gateway],
                      },
                    ],
                  }),
              infrastructure: {
                annotations: {
                  "juntai.dev/service-type":
                    args.inputs.serviceType ?? "LoadBalancer",
                },
              },
              listeners: [listener(gateway, tlsSecret)],
            },
          },
          {
            provider: args.provider,
            dependsOn: [gatewayClass],
            ...adoptionOptions(
              args.adoption,
              `gateway/resource/${GATEWAY_NAMES[gateway]}`,
            ),
          },
        );
        return [gateway, resource] as const;
      },
    ),
  ) as Record<keyof typeof GATEWAY_NAMES, k8s.apiextensions.CustomResource>;
  return Object.freeze({
    gatewayClassName: gatewayClass.metadata.name,
    gateways: Object.freeze(
      Object.fromEntries(
        Object.entries(gateways).map(([key, resource]) => [
          key,
          resource.metadata.name,
        ]),
      ) as GatewaySetOutput["gateways"],
    ),
    namespace: pulumi.output(args.namespace),
  });
}
