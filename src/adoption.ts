import type * as pulumi from "@pulumi/pulumi";
import type { AdoptionMap } from "./types.js";

export function adoptionOptions(
  adoption: AdoptionMap | undefined,
  key: string,
): Pick<
  pulumi.CustomResourceOptions,
  "aliases" | "import" | "protect" | "retainOnDelete"
> {
  const rule = adoption?.[key];
  return {
    ...(rule?.aliases === undefined ? {} : { aliases: [...rule.aliases] }),
    ...(rule?.import === undefined ? {} : { import: rule.import }),
    protect: rule?.protect ?? true,
    ...(rule?.retainOnDelete === undefined
      ? {}
      : { retainOnDelete: rule.retainOnDelete }),
  };
}

export function childMigration(
  adoption: AdoptionMap | undefined,
  key: string,
): {
  readonly aliases?: readonly pulumi.Input<pulumi.Alias>[];
  readonly import?: string;
  readonly protect: boolean;
  readonly retainOnDelete?: boolean;
} {
  const rule = adoption?.[key];
  return {
    ...(rule?.aliases === undefined ? {} : { aliases: [...rule.aliases] }),
    ...(rule?.import === undefined ? {} : { import: rule.import }),
    protect: rule?.protect ?? true,
    ...(rule?.retainOnDelete === undefined
      ? {}
      : { retainOnDelete: rule.retainOnDelete }),
  };
}
