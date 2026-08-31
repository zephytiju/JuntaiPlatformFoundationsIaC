import type * as pulumi from "@pulumi/pulumi";

type ObjectRecord = Record<string, unknown>;

function object(value: unknown, label: string): ObjectRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as ObjectRecord;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

export function projectWorkloadTokens(args: {
  readonly workloadAudience: string;
  readonly tokenReviewAudience?: string;
}): pulumi.ResourceTransformation {
  return ({ type, props, opts }) => {
    if (type !== "kubernetes:apps/v1:Deployment") return undefined;
    const spec = object(props.spec, "Deployment spec");
    const template = object(spec.template, "Deployment pod template");
    const podSpec = object(template.spec, "Deployment pod spec");
    const containers = array(
      podSpec.containers,
      "Deployment pod containers",
    ).map((value) => object(value, "Deployment container"));
    if (containers.length !== 1 || containers[0] === undefined) {
      throw new Error(
        "workload token projection requires exactly one service container",
      );
    }
    const volumeName = "juntai-workload-tokens";
    const volumeMounts = [
      ...array(containers[0].volumeMounts ?? [], "container volume mounts"),
      {
        name: volumeName,
        mountPath: "/var/run/secrets/juntai",
        readOnly: true,
      },
    ];
    const volumes = [
      ...array(podSpec.volumes ?? [], "pod volumes"),
      {
        name: volumeName,
        projected: {
          defaultMode: 0o440,
          sources: [
            {
              serviceAccountToken: {
                audience: args.workloadAudience,
                expirationSeconds: 3600,
                path: "token",
              },
            },
            {
              serviceAccountToken: {
                audience:
                  args.tokenReviewAudience ?? "https://kubernetes.default.svc",
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
    ];
    return {
      props: {
        ...props,
        spec: {
          ...spec,
          template: {
            ...template,
            spec: {
              ...podSpec,
              containers: [{ ...containers[0], volumeMounts }],
              volumes,
            },
          },
        },
      },
      opts,
    };
  };
}

export function pinRuntimeIdentity(args: {
  readonly uid: number;
  readonly gid: number;
}): pulumi.ResourceTransformation {
  return ({ type, props, opts }) => {
    if (type !== "kubernetes:apps/v1:Deployment") return undefined;
    const spec = object(props.spec, "Deployment spec");
    const template = object(spec.template, "Deployment pod template");
    const podSpec = object(template.spec, "Deployment pod spec");
    const containers = array(
      podSpec.containers,
      "Deployment pod containers",
    ).map((value) => object(value, "Deployment container"));
    if (containers.length !== 1 || containers[0] === undefined) {
      throw new Error(
        "runtime identity pin requires exactly one service container",
      );
    }
    const containerSecurityContext = object(
      containers[0].securityContext ?? {},
      "container security context",
    );
    const podSecurityContext = object(
      podSpec.securityContext ?? {},
      "pod security context",
    );
    return {
      props: {
        ...props,
        spec: {
          ...spec,
          template: {
            ...template,
            spec: {
              ...podSpec,
              securityContext: {
                ...podSecurityContext,
                runAsNonRoot: true,
                runAsUser: args.uid,
                runAsGroup: args.gid,
                fsGroup: args.gid,
              },
              containers: [
                {
                  ...containers[0],
                  securityContext: {
                    ...containerSecurityContext,
                    runAsNonRoot: true,
                    runAsUser: args.uid,
                    runAsGroup: args.gid,
                  },
                },
              ],
            },
          },
        },
      },
      opts,
    };
  };
}

export function rewriteGatewayPrefix(
  backendPathPrefix: `/${string}`,
): pulumi.ResourceTransformation {
  return ({ props, opts }) => {
    if (props.kind !== "HTTPRoute") return undefined;
    const spec = object(props.spec, "HTTPRoute spec");
    const rules = array(spec.rules, "HTTPRoute rules").map((value) => {
      const rule = object(value, "HTTPRoute rule");
      return {
        ...rule,
        filters: [
          ...array(rule.filters ?? [], "HTTPRoute filters"),
          {
            type: "URLRewrite",
            urlRewrite: {
              path: {
                type: "ReplacePrefixMatch",
                replacePrefixMatch: backendPathPrefix,
              },
            },
          },
        ],
      };
    });
    return { props: { ...props, spec: { ...spec, rules } }, opts };
  };
}
