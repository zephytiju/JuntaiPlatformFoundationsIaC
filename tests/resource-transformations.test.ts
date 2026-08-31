import type * as pulumi from "@pulumi/pulumi";
import { describe, expect, it } from "vitest";
import {
  pinRuntimeIdentity,
  projectWorkloadTokens,
  rewriteGatewayPrefix,
} from "../src/resource-transformations.js";

function transformationArgs(
  type: string,
  props: Record<string, unknown>,
): pulumi.ResourceTransformationArgs {
  return {
    resource: {} as pulumi.Resource,
    type,
    name: "test",
    props,
    opts: {},
  };
}

describe("foundation resource transformations", () => {
  it("projects bounded workload and token-review credentials", () => {
    const transform = projectWorkloadTokens({
      workloadAudience: "juntai-platform",
    });
    expect(
      transform(transformationArgs("kubernetes:core/v1:ConfigMap", {})),
    ).toBeUndefined();
    const result = transform(
      transformationArgs("kubernetes:apps/v1:Deployment", {
        spec: {
          template: {
            spec: {
              containers: [{ name: "service", volumeMounts: [] }],
              volumes: [],
            },
          },
        },
      }),
    );
    expect(result?.props).toMatchObject({
      spec: {
        template: {
          spec: {
            containers: [
              {
                volumeMounts: [
                  {
                    mountPath: "/var/run/secrets/juntai",
                    name: "juntai-workload-tokens",
                    readOnly: true,
                  },
                ],
              },
            ],
            volumes: [
              {
                projected: {
                  defaultMode: 0o440,
                  sources: [
                    {
                      serviceAccountToken: {
                        audience: "juntai-platform",
                        expirationSeconds: 3600,
                        path: "token",
                      },
                    },
                    {
                      serviceAccountToken: {
                        audience: "https://kubernetes.default.svc",
                        expirationSeconds: 3600,
                        path: "token-reviewer",
                      },
                    },
                    {
                      configMap: {
                        name: "kube-root-ca.crt",
                        items: [{ key: "ca.crt", path: "kube-root-ca.crt" }],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    });
    expect(() =>
      transform(
        transformationArgs("kubernetes:apps/v1:Deployment", {
          spec: { template: { spec: { containers: [] } } },
        }),
      ),
    ).toThrow(/exactly one service container/);
    expect(() =>
      transform(
        transformationArgs("kubernetes:apps/v1:Deployment", { spec: null }),
      ),
    ).toThrow(/Deployment spec must be an object/);
    expect(() =>
      transform(
        transformationArgs("kubernetes:apps/v1:Deployment", {
          spec: { template: { spec: { containers: {} } } },
        }),
      ),
    ).toThrow(/Deployment pod containers must be an array/);
  });

  it("adds a Gateway API prefix replacement while retaining filters", () => {
    const transform = rewriteGatewayPrefix("/v1");
    expect(
      transform(
        transformationArgs("kubernetes:core/v1:Service", { kind: "Service" }),
      ),
    ).toBeUndefined();
    const result = transform(
      transformationArgs("kubernetes:gateway.networking.k8s.io/v1:HTTPRoute", {
        kind: "HTTPRoute",
        spec: {
          rules: [
            {
              filters: [{ type: "RequestHeaderModifier" }],
              matches: [],
            },
          ],
        },
      }),
    );
    expect(result?.props).toMatchObject({
      spec: {
        rules: [
          {
            filters: [
              { type: "RequestHeaderModifier" },
              {
                type: "URLRewrite",
                urlRewrite: {
                  path: {
                    type: "ReplacePrefixMatch",
                    replacePrefixMatch: "/v1",
                  },
                },
              },
            ],
          },
        ],
      },
    });
  });

  it("pins the released non-root runtime identity", () => {
    const transform = pinRuntimeIdentity({ uid: 65532, gid: 65532 });
    expect(
      transform(transformationArgs("kubernetes:core/v1:Service", {})),
    ).toBeUndefined();
    const result = transform(
      transformationArgs("kubernetes:apps/v1:Deployment", {
        spec: {
          template: {
            spec: {
              securityContext: { seccompProfile: { type: "RuntimeDefault" } },
              containers: [
                {
                  name: "service",
                  securityContext: { readOnlyRootFilesystem: true },
                },
              ],
            },
          },
        },
      }),
    );
    expect(result?.props).toMatchObject({
      spec: {
        template: {
          spec: {
            securityContext: {
              fsGroup: 65532,
              runAsGroup: 65532,
              runAsNonRoot: true,
              runAsUser: 65532,
              seccompProfile: { type: "RuntimeDefault" },
            },
            containers: [
              {
                securityContext: {
                  readOnlyRootFilesystem: true,
                  runAsGroup: 65532,
                  runAsNonRoot: true,
                  runAsUser: 65532,
                },
              },
            ],
          },
        },
      },
    });
    expect(() =>
      transform(
        transformationArgs("kubernetes:apps/v1:Deployment", {
          spec: { template: { spec: { containers: [] } } },
        }),
      ),
    ).toThrow(/exactly one service container/);
  });
});
