import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { beforeAll, expect, it } from "vitest";
import { deployNativeVerificationSubstrate } from "../src/native-verification-substrate.js";

const resources: { type: string; inputs: Record<string, unknown> }[] = [];
beforeAll(() => {
  pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push({
          type: args.type,
          inputs: args.inputs as Record<string, unknown>,
        });
        return { id: args.name, state: args.inputs };
      },
      call: (args) => args.inputs,
    },
    "native-substrate",
    "development-local",
    false,
  );
});
it("limits its four services to an expiring task namespace and keeps secret inputs secret", async () => {
  const result = deployNativeVerificationSubstrate({
    provider: new k8s.Provider("native-substrate-provider"),
    stage: "development-local",
    namespace: "nous-r2-t100721",
    // Explicit rendering-only placeholders; no key generation or backend allocation.
    privateFiles: {
      "casdoor-password": "render-only",
      "database-password": "render-only",
      "object-password": "render-only",
      "app.conf": "render-only",
      "init.json": "render-only",
      "tls.pem": "render-only",
      "tls-key.pem": "render-only",
    },
  });
  await Promise.all(
    result.workloads
      .flatMap((w) => [w.job.urn, w.service.urn])
      .map((v) => new Promise((resolve) => v.apply(resolve))),
  );
  expect(result.allocation).toBe("declared");
  expect(await pulumi.isSecret(result.secret.stringData)).toBe(true);
  const jobs = resources.filter((r) => r.type === "kubernetes:batch/v1:Job");
  expect(jobs).toHaveLength(4);
  expect(
    jobs.find(
      (job) => (job.inputs.metadata as { name: string }).name === "r2-casdoor",
    )?.inputs,
  ).toMatchObject({
    spec: {
      template: {
        spec: {
          securityContext: { fsGroup: 65532 },
          volumes: [{ name: "config", secret: { defaultMode: 0o440 } }],
        },
      },
    },
  });
  for (const job of jobs) {
    const props = job.inputs as {
      metadata: { namespace: string };
      spec: {
        activeDeadlineSeconds: number;
        backoffLimit: number;
        template: {
          spec: {
            automountServiceAccountToken: boolean;
            restartPolicy: string;
            volumes: Record<string, unknown>[];
          };
        };
      };
    };
    expect(props.metadata.namespace).toBe("nous-r2-t100721");
    expect(props.spec.activeDeadlineSeconds).toBe(7200);
    expect(props.spec.backoffLimit).toBe(0);
    expect(props.spec.template.spec.restartPolicy).toBe("Never");
    expect(props.spec.template.spec.automountServiceAccountToken).toBe(false);
    expect(props.spec.template.spec.volumes.some((v) => "hostPath" in v)).toBe(
      false,
    );
  }
  expect(
    resources.filter((r) => r.type === "kubernetes:core/v1:Service"),
  ).toHaveLength(4);
  expect(
    resources.some((r) => /ClusterRole|PersistentVolume/.test(r.type)),
  ).toBe(false);
});
it("rejects a shared namespace before registering resources", () => {
  expect(() =>
    deployNativeVerificationSubstrate({
      provider: new k8s.Provider("invalid-target-provider"),
      stage: "development-local",
      namespace: "juntai-capabilities",
      privateFiles: {} as never,
    }),
  ).toThrow("own task namespace");
});
