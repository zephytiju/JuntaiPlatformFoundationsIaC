import { readFileSync } from "node:fs";
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { beforeAll, expect, it } from "vitest";
import { offlineReaderExposures } from "./fixtures/full-host-readers.js";
import { FULL_HOST_UIDS } from "../src/native-full-host-network.js";
import {
  deployNativeFullHostEnvironment,
  FULL_HOST_FOUNDATION_IMAGES,
  FULL_HOST_SEALER_IMAGE,
  type NativeFullHostWorkload,
} from "../src/native-full-host-environment.js";

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
    "native-full-host-render",
    "development-local",
    false,
  );
});

function input(provider: k8s.Provider) {
  type Role = Exclude<keyof typeof FULL_HOST_UIDS, "model">;
  const workloads = Object.fromEntries(
    Object.keys(FULL_HOST_UIDS)
      .filter((role) => role !== "model")
      .map((role) => [
        role,
        {
          // These are rendering-only inputs, not runnable domain service declarations.
          image:
            FULL_HOST_FOUNDATION_IMAGES[
              role as keyof typeof FULL_HOST_FOUNDATION_IMAGES
            ] ?? FULL_HOST_SEALER_IMAGE,
          publicFiles: { "unit.json": "{}" },
          privateFiles: { "unit-private": "rendering-only" },
        },
      ]),
  ) as unknown as Record<Role, NativeFullHostWorkload>;
  workloads.collector = {
    ...workloads.collector,
    privateEnvironment: {
      CLICKHOUSE_USER: "user",
      CLICKHOUSE_PASSWORD: "password",
      COLLECTOR_RELAY: "relay",
    },
    privateFiles: Object.fromEntries(
      ["user", "password", "relay", "cert.pem", "key.pem", "ca.pem"].map(
        (k) => [k, "offline-rendering-only"],
      ),
    ),
  };
  return {
    telemetry: {
      mode: "sidecar" as const,
      image: FULL_HOST_FOUNDATION_IMAGES.collector,
      database: "nous_telemetry",
      bindingId: "telemetry",
      tenant: "offline-rendering-only",
      scope: { runtime: "offline-rendering-only" },
      ingestionIdentity: "offline-rendering-only",
      layouts: JSON.parse(
        readFileSync(
          new URL(
            "./fixtures/full-host-telemetry-layouts.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
      receiverTls: {
        mode: "mutual" as const,
        serverName: "collector.m4.invalid",
        caRef: { provider: "test", reference: "ca" },
        clientCertificateRef: { provider: "test", reference: "client" },
      },
      tlsFiles: {
        certificate: "/run/m4/cert.pem",
        key: "/run/m4/key.pem",
        clientCa: "/run/m4/ca.pem",
        backendCa: "/run/m4/ca.pem",
        receiverCa: "/run/m4/ca.pem",
      },
      backendEndpoint: "https://telemetry-db.m4.invalid:8443",
      backendIdentityEnvironment: "CLICKHOUSE_USER",
      backendCredentialEnvironment: "CLICKHOUSE_PASSWORD",
      relayCredentialEnvironment: "COLLECTOR_RELAY",
      queueDirectory: "/var/lib/collector/queue",
      queueRequests: 8,
      maxEnvelopeBytes: 32768,
      maxBatchBytes: 1048576,
      maxBatchRows: 100,
      insertQuorum: 1,
    },
    provider,
    stage: "development-local" as const,
    namespace: "nous-full-host-t100340",
    readerExposures: offlineReaderExposures(),
    workloads,
    modelCredentials: {
      "api-key": "rendering-only",
      "tls.pem": "rendering-only",
      "tls-key.pem": "rendering-only",
      "ca.pem": "rendering-only",
    },
  };
}

it("stages before isolation and constrains every service to its own UID and private material", async () => {
  const allocation = deployNativeFullHostEnvironment(
    input(new k8s.Provider("full-host-test")),
  );
  await Promise.all(
    allocation.resources.map(
      (r) => new Promise((resolve) => r.urn.apply(resolve)),
    ),
  );
  expect(allocation.allocation).toBe("declared");
  expect(allocation.nativeAdmission).toBe(false);
  const jobs = resources.filter((r) => r.type === "kubernetes:batch/v1:Job");
  expect(jobs).toHaveLength(1);
  const job = jobs[0]!.inputs as unknown as k8s.types.output.batch.v1.Job;
  expect(job.spec.backoffLimit).toBe(0);
  expect(job.spec.activeDeadlineSeconds).toBe(7200);
  const pod = job.spec.template.spec;
  expect(pod.automountServiceAccountToken).toBe(false);
  expect([
    pod.hostNetwork,
    pod.hostPID,
    pod.hostIPC,
    pod.shareProcessNamespace,
  ]).toEqual([false, false, false, false]);
  expect(pod.initContainers.map((c) => c.name)).toEqual([
    "stage-model",
    "seal-network",
    "stage-private-files",
  ]);
  expect(pod.initContainers[1]!.securityContext.capabilities).toEqual({
    drop: ["ALL"],
    add: ["NET_ADMIN"],
  });
  expect(pod.initContainers[2]!.securityContext.capabilities).toEqual({
    drop: ["ALL"],
    add: ["CHOWN"],
  });
  const normalize = (name: string) =>
    name.replace(/[A-Z]/g, (v) => "-" + v.toLowerCase());
  expect(pod.containers).toHaveLength(Object.keys(FULL_HOST_UIDS).length);
  for (const [role, uid] of Object.entries(FULL_HOST_UIDS)) {
    const name = normalize(role),
      container = pod.containers.find((c) => c.name === name)!;
    expect(container.securityContext).toMatchObject({
      runAsUser: uid,
      runAsGroup: uid,
      runAsNonRoot: true,
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      capabilities: { drop: ["ALL"] },
    });
    expect(
      container.volumeMounts.filter((m) => m.name.endsWith("-material")),
    ).toEqual([
      {
        name: name + "-material",
        mountPath: role === "model" ? "/credentials" : "/run/m4",
        readOnly: true,
      },
    ]);
    expect(
      container.volumeMounts.some((m) => m.name === name + "-config"),
    ).toBe(false);
    expect(container.ports ?? []).toHaveLength(0);
  }
  expect(pod.volumes.some((v) => v.hostPath || v.persistentVolumeClaim)).toBe(
    false,
  );
  expect(
    resources.some((r) =>
      /:Service$|ClusterRole|PersistentVolume/.test(r.type),
    ),
  ).toBe(false);
  const collector = pod.containers.find((c) => c.name === "collector")!;
  expect(collector.args).toEqual([
    "--feature-gates=ottl.functions.enableLambda",
    "--config=/run/m4/collector.json",
  ]);
  expect(allocation.telemetryMigration.requiredLayouts).toHaveLength(3);
  expect(allocation.telemetryMigration.statements.length).toBeGreaterThan(3);
  const model = pod.containers.find((c) => c.name === "model")!;
  expect(
    model.args.slice(
      model.args.indexOf("--host"),
      model.args.indexOf("--host") + 4,
    ),
  ).toEqual(["--host", "127.0.0.1", "--port", "9843"]);
  for (const resource of allocation.resources.filter(
    (r) => r instanceof k8s.core.v1.Secret,
  ))
    expect(await pulumi.isSecret(resource.stringData)).toBe(true);
});

it("rejects unbounded targets, omitted services and mutable or substituted Foundation images", () => {
  const args = input(new k8s.Provider("full-host-rejections"));
  expect(() =>
    deployNativeFullHostEnvironment({ ...args, namespace: "shared" }),
  ).toThrow(/fresh disposable/);
  expect(() =>
    deployNativeFullHostEnvironment({ ...args, stage: "production" as never }),
  ).toThrow(/fresh disposable/);
  expect(() =>
    deployNativeFullHostEnvironment({ ...args, workloads: {} as never }),
  ).toThrow(/exact full-host service inventory/);
  const mutable = structuredClone(args.workloads);
  mutable.nous = { ...mutable.nous, image: "example/runtime:latest" };
  expect(() =>
    deployNativeFullHostEnvironment({ ...args, workloads: mutable }),
  ).toThrow(/immutable/);
  const replaced = structuredClone(args.workloads);
  replaced.casdoor = { ...replaced.casdoor, image: FULL_HOST_SEALER_IMAGE };
  expect(() =>
    deployNativeFullHostEnvironment({ ...args, workloads: replaced }),
  ).toThrow(/Foundation-owned/);
});

it("rejects telemetry routing, command and credential overrides", () => {
  const args = input(new k8s.Provider("full-host-telemetry-rejections"));
  for (const delta of [
    { backendEndpoint: "https://other.invalid:8443" },
    { queueDirectory: "/tmp/queue" },
    { image: FULL_HOST_SEALER_IMAGE },
    { mode: "gateway" as const },
    { replicas: 2 },
    {
      receiverTls: {
        ...args.telemetry.receiverTls,
        serverName: "other.invalid",
      },
    },
    { tlsFiles: { ...args.telemetry.tlsFiles, key: "/tmp/key.pem" } },
  ])
    expect(() =>
      deployNativeFullHostEnvironment({
        ...args,
        telemetry: { ...args.telemetry, ...delta },
      }),
    ).toThrow(/telemetry must use/);
  for (const delta of [
    { command: ["sh"] },
    { args: ["other.json"] },
    { publicFiles: { "collector.json": "{}" } },
  ])
    expect(() =>
      deployNativeFullHostEnvironment({
        ...args,
        workloads: {
          ...args.workloads,
          collector: { ...args.workloads.collector, ...delta },
        },
      }),
    ).toThrow(/Collector execution/);
  expect(() =>
    deployNativeFullHostEnvironment({
      ...args,
      workloads: {
        ...args.workloads,
        collector: { ...args.workloads.collector, privateEnvironment: {} },
      },
    }),
  ).toThrow(/private environment/);
});
