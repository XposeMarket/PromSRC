# Independent public-API consumer

This package imports only `prometheus/embed`. Its scripted model checks a tool
round-trip, raw tool results, event delivery and cancellation without credentials.
HTTP, HTTPS, TCP, TLS and fetch entrypoints fail if called. This is deterministic
contract evidence, not evidence of real-provider quality or a security sandbox.

From the repository (PowerShell; Node 20+):

```powershell
npm run build:backend
$consumer = Join-Path $env:TEMP ('embed-consumer-' + [guid]::NewGuid())
New-Item -ItemType Directory $consumer | Out-Null
Copy-Item examples/embed-consumer/index.mjs,examples/embed-consumer/package.json $consumer
npm pack --ignore-scripts --pack-destination $consumer
# Use the tarball just printed by npm pack, not a registry package with the same name.
$tarball = (Get-ChildItem $consumer -Filter prometheus-*.tgz).FullName
Push-Location $consumer
npm install --offline --ignore-scripts --omit=optional --no-audit --no-fund $tarball
npm test
Pop-Location
```

`node scripts/test-embed-consumer.mjs` automates this exact packed/install/run
boundary after a backend build and cleans up the temporary project. Offline
installation needs dependencies cached already. Remove `--offline` only when
you deliberately want to populate npm's cache; the runtime verification itself
still forbids outbound networking. No dependency-install lifecycle scripts run.

The repository retains desktop and provider dependencies in its package, so the
tarball is not a minimal embedding distribution. One runtime is active per
process; close it before another runtime. No Electron process or gateway is
started, and real providers, native add-ons, browser automation and remote APIs
are not exercised by this test.

If the offline cache is incomplete, the explicit diagnostic
`node scripts/test-embed-consumer.mjs --shared-dependencies` unpacks actual npm
packed bytes into a temporary consumer and resolves external dependencies via
`NODE_PATH` from the existing host installation. It still uses the public export
and never links Prometheus source, but **does not prove independent dependency
installation**. This mode is never selected implicitly by `npm run test:embed`.

For an explicit registry-assisted installation use
`node scripts/test-embed-consumer.mjs --online-install`. Dependency resolution
may fail independently of the embedding API (observed `qs@~6.16.0` ETARGET on
this host). No mode claims that shared dependencies prove a clean installation.
