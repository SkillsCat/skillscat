# CLI releases

The `Publish CLI` GitHub Actions workflow tests, builds, and publishes the version
already committed in `apps/cli/package.json`. It publishes to npm using OIDC and
attaches provenance. It does not need an npm token stored in GitHub secrets.

## One-time npm configuration

An npm package owner must open the settings for `skillscat` on npmjs.com and add
a **Trusted Publisher** with these exact values:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `SkillsCat` |
| Repository | `skillscat` |
| Workflow filename | `publish-cli.yml` |
| Environment name | Leave empty |
| Allowed actions | Allow direct publishing with `npm publish` |

The settings page is https://www.npmjs.com/package/skillscat/access.
GitHub repository access alone does not grant npm package publishing permission.

## Publish a release

1. Update `apps/cli/package.json` to an unpublished version, then commit and push
   the release changes to `main`.
2. Dispatch the workflow with that exact version:

   ```sh
   gh workflow run publish-cli.yml --repo SkillsCat/skillscat --ref main -f version=0.2.1
   ```

3. Confirm the workflow succeeds and npm exposes the expected version:

   ```sh
   npm view skillscat version
   ```

Alternatively, pushing a `cli/v<version>` tag triggers the same workflow. The tag
must point at a commit whose package version matches. Use either dispatch or a
tag push for each release, since npm versions cannot be republished.

If npm rejects OIDC authentication, verify the trusted publisher fields and
direct publishing permission above, then rerun the failed workflow. Do not bump
the version unless npm already contains that version.
