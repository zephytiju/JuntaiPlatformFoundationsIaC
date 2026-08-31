import type * as pulumi from "@pulumi/pulumi";

export type PlatformStage =
  "development" | "development-local" | "production" | "staging";

export interface CapabilityKey<T> {
  readonly id: string;
  readonly version: string;
  readonly multiplexed: boolean;
  readonly __value?: T;
}

export interface CapabilityConsumer {
  require<T>(capability: CapabilityKey<T>): T;
  requireAll<T>(capability: CapabilityKey<T>): readonly T[];
  provide<T>(capability: CapabilityKey<T>, value: T): unknown;
}

export interface SecretReferenceResolver {
  require(
    id: string,
    key: string,
  ): {
    readonly id: string;
    readonly key: string;
    readonly value: pulumi.Output<string>;
  };
}

export interface PlatformTarget {
  readonly organization: string;
  readonly project: string;
  readonly stack: string;
  readonly environment: string;
  readonly configuration: Readonly<Record<string, unknown>>;
}

export interface PackageContext<
  TProviders extends Readonly<Record<string, unknown>>,
  TInputs extends Readonly<Record<string, unknown>>,
> {
  readonly target: PlatformTarget;
  readonly providers: TProviders;
  readonly secrets: SecretReferenceResolver;
  readonly capabilities: CapabilityConsumer;
  readonly inputs: TInputs;
}

export interface ImmutableReleaseInput {
  readonly id: string;
  readonly uri: string;
  readonly digest: `sha256:${string}`;
}

export interface PlatformIacPackage<
  TProviders extends Readonly<Record<string, unknown>>,
  TInputs extends Readonly<Record<string, unknown>>,
  TOutputs extends Readonly<Record<string, unknown>>,
> {
  readonly id: string;
  readonly version: string;
  readonly targetProfiles: readonly PlatformStage[];
  readonly owners: readonly string[];
  readonly compatibility: {
    readonly coreContract: string;
    readonly capabilityContracts: string;
    readonly constructLibraries: Readonly<Record<string, string>>;
  };
  readonly releaseInputs: readonly ImmutableReleaseInput[];
  readonly requires: readonly CapabilityKey<unknown>[];
  readonly provides: readonly CapabilityKey<unknown>[];
  deploy(
    context: PackageContext<TProviders, TInputs>,
  ): { readonly outputs: TOutputs } | Promise<{ readonly outputs: TOutputs }>;
}
