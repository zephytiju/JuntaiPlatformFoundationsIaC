# npm release process

`@juntai/platform-foundations-iac` is released from reviewed commits on `main`. The `foundations-iac-v<version>` tag must identify the same version as `package.json` and trigger `.github/workflows/release.yml`.

Normal releases use npm trusted publishing from GitHub Actions. The trusted publisher is restricted to:

- GitHub owner: `zephytiju`
- Repository: `JuntaiPlatformFoundationsIaC`
- Workflow: `release.yml`
- Environment: `npm`
- Allowed action: `npm publish`

The npm package must exist before that package-level trust can be configured. The one-time bootstrap therefore publishes the first reviewed version interactively with account 2FA and `--provenance=false`, configures the trusted publisher above, and then publishes the next reviewed version through the tag workflow. Only the CI-published version becomes the supported Core dependency. Every later version is CI-only and carries npm's registry provenance.

After publication, verify the exact registry `version`, `dist.tarball`, `dist.shasum`, `dist.integrity`, and attestations. Then install the exact version in an empty external directory, generate a registry lockfile, run `npm ci`, typecheck an import, and load the exported package contract. Core must never fall back to a GitHub archive or source staging path.
