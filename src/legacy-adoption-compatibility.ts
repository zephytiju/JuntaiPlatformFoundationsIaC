import * as pulumi from "@pulumi/pulumi";
import type { LegacyAdoptionCompatibility } from "./types.js";

export interface LegacyAdoptionResourceIdentity {
  readonly type: string;
  readonly name: string;
}

/**
 * Resources imported from the Core v1.9.0 stack whose live inputs are the
 * approved migration baseline. The compatibility profile deliberately keeps
 * those inputs stable after the one-shot imports are removed. This preserves
 * every physical UID and prevents the Kubernetes provider from issuing an
 * update patch while ownership moves to this package.
 */
export const LEGACY_CORE_V1_9_ADOPTION_RESOURCES: readonly LegacyAdoptionResourceIdentity[] =
  Object.freeze([
    { type: "kubernetes:core/v1:Namespace", name: "juntai-capabilities" },
    { type: "kubernetes:core/v1:Namespace", name: "juntai-gateway" },
    { type: "kubernetes:core/v1:Namespace", name: "juntai-observability" },
    { type: "kubernetes:core/v1:Namespace", name: "juntai-platform" },
    {
      type: "kubernetes:apps/v1:Deployment",
      name: "otel-gateway-deployment",
    },
    {
      type: "kubernetes:core/v1:ConfigMap",
      name: "foundations-meridian-runtime-config",
    },
    {
      type: "kubernetes:core/v1:ServiceAccount",
      name: "otel-gateway-identity",
    },
    { type: "kubernetes:core/v1:Service", name: "otel-gateway" },
    {
      type: "kubernetes:gateway.networking.k8s.io/v1:Gateway",
      name: "gateway-internal",
    },
    {
      type: "kubernetes:gateway.networking.k8s.io/v1:Gateway",
      name: "gateway-operator",
    },
    {
      type: "kubernetes:gateway.networking.k8s.io/v1:Gateway",
      name: "gateway-platform",
    },
    {
      type: "kubernetes:gateway.networking.k8s.io/v1:Gateway",
      name: "gateway-public",
    },
    {
      type: "kubernetes:gateway.networking.k8s.io/v1:GatewayClass",
      name: "juntai-platform-gateway-class",
    },
    {
      type: "kubernetes:admissionregistration.k8s.io/v1:MutatingWebhookConfiguration",
      name: "envoy-gateway-v1-8-3:envoy-gateway-topology-injector.envoy-gateway-system",
    },
    {
      type: "kubernetes:admissionregistration.k8s.io/v1:ValidatingAdmissionPolicy",
      name: "gateway-api-v1-5-1:safe-upgrades.gateway.networking.k8s.io",
    },
    {
      type: "kubernetes:admissionregistration.k8s.io/v1:ValidatingAdmissionPolicyBinding",
      name: "gateway-api-v1-5-1:safe-upgrades.gateway.networking.k8s.io",
    },
    ...[
      "backends.gateway.envoyproxy.io",
      "backendtrafficpolicies.gateway.envoyproxy.io",
      "clienttrafficpolicies.gateway.envoyproxy.io",
      "envoyextensionpolicies.gateway.envoyproxy.io",
      "envoypatchpolicies.gateway.envoyproxy.io",
      "envoyproxies.gateway.envoyproxy.io",
      "httproutefilters.gateway.envoyproxy.io",
      "securitypolicies.gateway.envoyproxy.io",
    ].map((name) => ({
      type: "kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition",
      name: `envoy-gateway-v1-8-3:${name}`,
    })),
    ...[
      "backendtlspolicies.gateway.networking.k8s.io",
      "gatewayclasses.gateway.networking.k8s.io",
      "gateways.gateway.networking.k8s.io",
      "grpcroutes.gateway.networking.k8s.io",
      "httproutes.gateway.networking.k8s.io",
      "listenersets.gateway.networking.k8s.io",
      "referencegrants.gateway.networking.k8s.io",
      "tlsroutes.gateway.networking.k8s.io",
    ].map((name) => ({
      type: "kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition",
      name: `gateway-api-v1-5-1:${name}`,
    })),
    {
      type: "kubernetes:apps/v1:Deployment",
      name: "envoy-gateway-v1-8-3:envoy-gateway-system/envoy-gateway",
    },
    {
      type: "kubernetes:core/v1:ConfigMap",
      name: "envoy-gateway-v1-8-3:envoy-gateway-system/envoy-gateway-config",
    },
    {
      type: "kubernetes:core/v1:Namespace",
      name: "envoy-gateway-v1-8-3:envoy-gateway-system",
    },
    {
      type: "kubernetes:core/v1:Service",
      name: "envoy-gateway-v1-8-3:envoy-gateway-system/envoy-gateway",
    },
    {
      type: "kubernetes:core/v1:ServiceAccount",
      name: "envoy-gateway-v1-8-3:envoy-gateway-system/envoy-gateway",
    },
  ]);

const legacyResourceKeys = new Set(
  LEGACY_CORE_V1_9_ADOPTION_RESOURCES.map(
    ({ type, name }) => `${type}\0${name}`,
  ),
);

const legacyNamespaceResourceKeys = new Set(
  LEGACY_CORE_V1_9_ADOPTION_RESOURCES.filter(
    ({ type }) => type === "kubernetes:core/v1:Namespace",
  ).map(({ type, name }) => `${type}\0${name}`),
);

export interface LegacyAdoptionCompatibilityTransformResult {
  readonly props: pulumi.Inputs;
  readonly opts: pulumi.ResourceOptions;
}

export function legacyAdoptionCompatibilityTransform(
  type: string,
  name: string,
  properties: pulumi.Inputs,
  options: pulumi.ResourceOptions,
): LegacyAdoptionCompatibilityTransformResult | undefined {
  const resourceKey = `${type}\0${name}`;
  if (!legacyResourceKeys.has(resourceKey)) return undefined;
  const props = legacyNamespaceResourceKeys.has(resourceKey)
    ? {
        ...properties,
        // Kubernetes defaulted this field into the Core v1.9.0 inputs. Keep
        // it explicit so the retained Namespace desired state is identical.
        spec: { finalizers: ["kubernetes"] },
      }
    : properties;
  return {
    props,
    opts: {
      ...options,
      // This profile is a UID-preserving ownership transfer, not a rollout.
      // Fresh resources still receive their complete desired inputs on create.
      ignoreChanges: Object.keys(props).sort(),
    },
  };
}

export function legacyAdoptionCompatibilityOptions(
  type: string,
  name: string,
  properties: pulumi.Inputs,
  options: pulumi.ResourceOptions,
): pulumi.ResourceOptions | undefined {
  return legacyAdoptionCompatibilityTransform(type, name, properties, options)
    ?.opts;
}

export function registerLegacyAdoptionCompatibility(
  compatibility: LegacyAdoptionCompatibility | undefined,
): void {
  if (compatibility === undefined) return;
  pulumi.runtime.registerStackTransform((args) => {
    return legacyAdoptionCompatibilityTransform(
      args.type,
      args.name,
      args.props,
      args.opts,
    );
  });
}
