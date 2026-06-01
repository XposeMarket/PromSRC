# 34) Public Release and Self-Update Operations

This section is Prometheus' owner-approved runbook for preparing, committing, pushing, and publishing public desktop updates.

The goal is not unattended self-release. The goal is supervised self-improvement: Prometheus may inspect, edit, verify, stage, commit, push, build, and publish only when Raul explicitly asks for that release operation and provides the required approval/token context.

## Operating boundary

Prometheus may help ship a public update when all of these are true:

- Raul explicitly asks to prepare or publish a public Prometheus release.
- The intended release scope is reviewed before staging.
- Public build verification passes.
- The packaged app is smoke-tested.
- Raul authorizes the final push/publish step.
- GitHub tokens are supplied only through the local shell environment, never saved into memory files, source files, logs, or committed config.

Prometheus must not:

- auto-publish a public release just because it changed its own code
- store GitHub tokens or release credentials in the workspace
- run broad `git add .` in a dirty tree without first reviewing status
- commit private workspace memory, logs, experiments, local runtime artifacts, or release binaries into PromSRC
- bypass public-build verification
- publish source-edit/dev-tool access to public Electron builds

## Standard public update flow

1. Inspect the tree before doing anything:

```powershell
git status
```

2. Review the dirty files and decide the release scope. Stage only intentional product/source files, generated public web UI files that correspond to source changes, package version files, release scripts/config, and any intentional PromSite submodule pointer update.

Avoid committing:

- `workspace/tool_audit.log`
- private workspace memory churn
- local Brain/task artifacts
- transient screenshots, videos, zips, installers, or unpacked release output
- unrelated experiments

3. Check the currently published public version:

```powershell
Invoke-RestMethod https://api.github.com/repos/XposeMarket/prometheus-releases/releases/latest
```

If the latest public release already matches `package.json`, bump `package.json` and `package-lock.json` before publishing.

4. Run pre-release verification:

```powershell
npm run check:web-ui
npm run build
npm run build:public
```

Expected local public artifacts:

```text
release-public/Prometheus-Setup-<version>.exe
release-public/Prometheus-Setup-<version>.exe.blockmap
release-public/latest.yml
release-public/win-unpacked/
```

5. Smoke-test the packaged app:

```powershell
.\release-public\win-unpacked\Prometheus.exe
```

Confirm:

- gateway starts
- UI loads
- chat and settings flows do not error
- update wiring does not error
- public users cannot see or use Prometheus source/dev/self-edit tools
- public bundled skills do not include private/dev/Raul-specific playbooks
- public Brain prompts do not instruct self-editing of Prometheus source

6. Stage only reviewed release files. Prefer explicit paths over broad staging:

```powershell
git add package.json package-lock.json src web-ui generated scripts electron-builder-public.yml
```

Also stage `.gitmodules` and `workspace/PromSite` only when the website submodule pointer intentionally changed.

7. Commit and push PromSRC:

```powershell
git commit -m "Prepare public release vX.Y.Z"
git push origin main
```

8. Publish the public release. The token must be set only for the command session:

```powershell
$env:GH_TOKEN="YOUR_TOKEN"
npm run release
Remove-Item Env:GH_TOKEN
```

9. Verify the public GitHub release:

```powershell
Invoke-RestMethod https://api.github.com/repos/XposeMarket/prometheus-releases/releases/latest
```

Confirm:

- `tag_name` is the intended new version
- `draft` is `false`
- `prerelease` is `false`
- assets include `latest.yml`
- assets include `Prometheus-Setup-<version>.exe`
- assets include `Prometheus-Setup-<version>.exe.blockmap`

10. Verify PromSite download routing. The website should resolve latest downloads through:

```text
https://api.github.com/repos/XposeMarket/prometheus-releases/releases/latest
```

If the site has a short cache/revalidate window, wait a few minutes and re-check.

## If electron-builder reports publish success but GitHub latest does not update

Treat this as incomplete until verified. Check:

- public latest release endpoint
- tag-specific release endpoint
- release assets
- whether the release is draft/prerelease
- whether `latest.yml` uploaded

If needed, create or repair the GitHub release manually with the GitHub Releases API, then upload:

- `release-public/latest.yml`
- `release-public/Prometheus-Setup-<version>.exe`
- `release-public/Prometheus-Setup-<version>.exe.blockmap`

After repair, re-run the public latest-release check and confirm the site points at the new installer.

## Autonomy rule

Prometheus can be the release operator, but Raul remains the release authority.

Before any public push or publish, Prometheus should present:

- files it plans to commit
- version it plans to publish
- verification results
- packaged smoke-test result
- exact release assets that will become public

Then Prometheus should ask for explicit approval before pushing or publishing. This keeps self-improvement useful without letting an accidental prompt, compromised workspace, or bad local state ship to every public user.
