# Releasing Prometheus

## Principles

- **CI is the primary release path.** Use the repository release workflow to build, sign, verify, and publish from the reviewed release commit.
- Use `npm run release` only as a local fallback when CI is unavailable. It publishes externally; set `GH_TOKEN` only for that session and remove it afterwards.
- Releases normally ship every **1–2 weeks**. Beta/RC candidates need a **2–3 day soak** plus an isolated smoke test before promotion.
- A hotfix is a patch release prepared from `main`, with the same version-bump PR and verification expectations.


## End-to-end flow

Feature/fix PR → `main` (keep it always releasable) → `release:prep` release PR → merge → tag → CI builds and publishes. Tags containing `-beta.N` or `-rc.N` create GitHub **prereleases**; plain version tags create full releases and become the latest stable release.

After merging the candidate release PR, update your local `main` to its merged commit and run, for example:

```bash
git tag -a v1.1.0-beta.1 -m "Release v1.1.0-beta.1"
git push origin v1.1.0-beta.1
```

The tag push automatically starts `.github/workflows/release.yml`. Manual dispatch takes an **existing tag**, never a branch. After the soak/smoke, prepare and merge the stable version PR, then tag `v1.1.0` on that merged commit. Installed apps on the matching channel discover the release automatically; downloads and installation keep their explicit confirmation and protected backup flow.

Desktop **Settings → Updates → Update channel** shows the installed version and persisted Stable/Beta choice. Stable is the default. Raul should choose **Beta** after installing a build with this setting; this source change deliberately does not modify his live machine. Switching back to Stable rejects prereleases and permits rollback only if the currently installed version is prerelease.

## Prepare the version and notes

Create a release branch from current `main`, then run:

```bash
npm run release:prep -- 1.2.3 --dry-run
npm run release:prep -- 1.2.3
```

`release:prep` accepts a SemVer version (stable, `-beta.N`, or `-rc.N`), updates only the root `version` values in `package.json` and `package-lock.json` (including `packages[""]`), and appends a grouped Features/Fixes/Other section to `CHANGELOG.md` when not in dry-run mode. It collects only merged PR titles or squash commits such as `(#123)`, deduplicates PRs, uses the nearest reachable tag or `--since <date-or-commit>` (default `2026-08-13`), and never writes in dry-run mode, tags, or pushes.

Commit `package.json`, `package-lock.json`, and `CHANGELOG.md`, then open a release PR. Merge the version-bump release PR before any stable tag. The command prints the exact follow-up release-PR/tag steps as reminders; review them rather than treating them as automatic actions.

## Candidate and stable promotion

Tag beta and RC candidates as SemVer prereleases (for example, `v1.2.3-beta.1` and `v1.2.3-rc.1`) from their reviewed candidate commits. Run the CI release workflow, let the candidate soak for 2–3 days, and perform an isolated installer/update smoke test.

For stable, merge the dedicated version-bump release PR to `main`, then create and push the stable tag from that merged release commit: `git tag -a v<version> -m "Release v<version>" && git push origin v<version>`. **Do not promote by merely re-tagging the beta/RC commit.** `main` must always remain releasable after reviewed PRs merge; pushing the tag automatically triggers the CI release workflow. Beta/RC tags create GitHub prereleases, while the stable tag creates the full GitHub release.

## CI pipeline behavior

- The macOS lane is skipped unless every macOS signing/notarization secret is configured. When it runs, both architecture jobs are optional (`continue-on-error`) so a Windows release can continue if a macOS architecture is unavailable.
- `release-macos.yml` is a compatibility wrapper; it triggers the full release pipeline rather than a separate macOS-only publication path.
- Each release publishes metadata aliases for `latest`, `beta`, and `rc`. The stable updater feed uses the GitHub stable release feed, which excludes prereleases.
- Azure signing is deliberately a placeholder and is **not enabled** merely because Azure credentials are present.
- The existing ASAR `path.sep` handling is intentional and must remain in place when packaging logic changes.

## CI, credentials, and signing

### Update channels

The updater reads release metadata aliases from the public `XposeMarket/prometheus-releases` repository: stable uses `latest`, while candidates use `beta` or `rc`. Channel selection is a **Raul manual opt-in**; do not switch customers to beta/RC automatically. Stable metadata uses GitHub's stable releases feed and therefore excludes prereleases.


Configure the required `RELEASE_GH_TOKEN` in **github.com/XposeMarket/PromSRC → Settings → Secrets and variables → Actions → New repository secret**. It must have `contents: write` permission to publish to the public `XposeMarket/prometheus-releases` repository. Keep the token out of source, logs, and shell history.

Optional macOS signing/notarization secrets are:

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Azure signing is an optional placeholder until its workflow is explicitly enabled. If used, configure:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_SIGNING_ENDPOINT`
- `AZURE_SIGNING_ACCOUNT`
- `AZURE_CERTIFICATE_PROFILE`

## Local fallback

Only after the release commit is merged and CI is unavailable, authenticate for the one local session and use:

```powershell
$env:GH_TOKEN = '...'
npm run release
Remove-Item Env:GH_TOKEN
```

Do not use the local fallback to skip review, required verification, the stable release PR, or the stable tag.
