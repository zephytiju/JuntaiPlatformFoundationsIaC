import type { PhysicalResourceIdentity } from "./gateway-manifests.js";

export interface EnvoyLegacyMigrationMapping {
  readonly legacy: PhysicalResourceIdentity;
  readonly replacement: PhysicalResourceIdentity;
}

export const ENVOY_LEGACY_MIGRATION_MAPPINGS: readonly EnvoyLegacyMigrationMapping[] =
  Object.freeze([
    {
      legacy: {
        apiVersion: "v1",
        kind: "ServiceAccount",
        namespace: "envoy-gateway-system",
        name: "envoy-gateway-certgen",
      },
      replacement: {
        apiVersion: "v1",
        kind: "ServiceAccount",
        namespace: "envoy-gateway-system",
        name: "eg-gateway-helm-certgen",
      },
    },
    {
      legacy: {
        apiVersion: "batch/v1",
        kind: "Job",
        namespace: "envoy-gateway-system",
        name: "envoy-gateway-certgen",
      },
      replacement: {
        apiVersion: "batch/v1",
        kind: "Job",
        namespace: "envoy-gateway-system",
        name: "eg-gateway-helm-certgen",
      },
    },
    {
      legacy: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "ClusterRole",
        namespace: null,
        name: "envoy-gateway-certgen",
      },
      replacement: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "ClusterRole",
        namespace: null,
        name: "eg-gateway-helm-certgen:envoy-gateway-system",
      },
    },
    {
      legacy: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "ClusterRole",
        namespace: null,
        name: "envoy-gateway",
      },
      replacement: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "ClusterRole",
        namespace: null,
        name: "eg-gateway-helm-envoy-gateway-role",
      },
    },
    {
      legacy: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "ClusterRoleBinding",
        namespace: null,
        name: "envoy-gateway-certgen",
      },
      replacement: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "ClusterRoleBinding",
        namespace: null,
        name: "eg-gateway-helm-certgen:envoy-gateway-system",
      },
    },
    {
      legacy: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "ClusterRoleBinding",
        namespace: null,
        name: "envoy-gateway",
      },
      replacement: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "ClusterRoleBinding",
        namespace: null,
        name: "eg-gateway-helm-envoy-gateway-rolebinding",
      },
    },
    {
      legacy: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "Role",
        namespace: "envoy-gateway-system",
        name: "envoy-gateway-certgen",
      },
      replacement: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "Role",
        namespace: "envoy-gateway-system",
        name: "eg-gateway-helm-certgen",
      },
    },
    {
      legacy: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "Role",
        namespace: "envoy-gateway-system",
        name: "envoy-gateway-infra-manager",
      },
      replacement: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "Role",
        namespace: "envoy-gateway-system",
        name: "eg-gateway-helm-infra-manager",
      },
    },
    {
      legacy: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "Role",
        namespace: "envoy-gateway-system",
        name: "envoy-gateway-leader-election",
      },
      replacement: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "Role",
        namespace: "envoy-gateway-system",
        name: "eg-gateway-helm-leader-election-role",
      },
    },
    {
      legacy: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "RoleBinding",
        namespace: "envoy-gateway-system",
        name: "envoy-gateway-certgen",
      },
      replacement: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "RoleBinding",
        namespace: "envoy-gateway-system",
        name: "eg-gateway-helm-certgen",
      },
    },
    {
      legacy: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "RoleBinding",
        namespace: "envoy-gateway-system",
        name: "envoy-gateway-infra-manager",
      },
      replacement: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "RoleBinding",
        namespace: "envoy-gateway-system",
        name: "eg-gateway-helm-infra-manager",
      },
    },
    {
      legacy: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "RoleBinding",
        namespace: "envoy-gateway-system",
        name: "envoy-gateway-leader-election",
      },
      replacement: {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "RoleBinding",
        namespace: "envoy-gateway-system",
        name: "eg-gateway-helm-leader-election-rolebinding",
      },
    },
  ]);
