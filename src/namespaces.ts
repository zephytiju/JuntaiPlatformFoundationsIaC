import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { adoptionOptions } from "./adoption.js";
import type { AdoptionMap } from "./types.js";

export const FOUNDATION_NAMESPACES = Object.freeze([
  "juntai-capabilities",
  "juntai-gateway",
  "juntai-iam",
  "juntai-observability",
  "juntai-platform",
] as const);

export type FoundationNamespace = (typeof FOUNDATION_NAMESPACES)[number];

export class FoundationNamespaceSet extends pulumi.ComponentResource {
  public readonly resources: Readonly<
    Record<FoundationNamespace, k8s.core.v1.Namespace>
  >;

  public constructor(
    name: string,
    args: {
      readonly provider: k8s.Provider;
      readonly adoption?: AdoptionMap;
    },
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super("juntai:foundations:NamespaceSet", name, {}, opts);
    this.resources = Object.freeze(
      Object.fromEntries(
        FOUNDATION_NAMESPACES.map((namespace) => [
          namespace,
          new k8s.core.v1.Namespace(
            namespace,
            {
              metadata: {
                name: namespace,
                labels: {
                  "app.kubernetes.io/managed-by":
                    "juntai-platform-foundations-iac",
                  "juntai.dev/foundation-owner": "shared",
                  ...([
                    "juntai-gateway",
                    "juntai-iam",
                    "juntai-platform",
                  ].includes(namespace)
                    ? { "juntai.dev/gateway-route-owner": "true" }
                    : {}),
                },
              },
            },
            {
              parent: this,
              provider: args.provider,
              ...adoptionOptions(args.adoption, `namespace/${namespace}`),
            },
          ),
        ]),
      ) as Record<FoundationNamespace, k8s.core.v1.Namespace>,
    );
    this.registerOutputs({
      namespaces: Object.fromEntries(
        Object.entries(this.resources).map(([key, value]) => [
          key,
          value.metadata.name,
        ]),
      ),
    });
  }
}
