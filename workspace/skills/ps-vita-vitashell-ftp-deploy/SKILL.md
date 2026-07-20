# PS Vita VitaShell FTP Deploy

Use this skill to transfer a VPK or other file from Windows to a PS Vita while VitaShell FTP mode is open.

## Objective
Upload the intended artifact, not a stale build, and independently prove the Vita copy is byte-for-byte identical.

## Workflow

### 1. Resolve the intended local artifact
- Read the latest relevant completed task output, project note, or build evidence first.
- Search the named project for plausible artifacts, normally `*.vpk`.
- Record candidate full paths, modification times, sizes, and SHA-256 hashes.
- Prefer the artifact explicitly identified by the latest completed build. Never choose solely because a file has the newest timestamp or a familiar filename.
- If one current artifact is unambiguous, proceed. If multiple plausible builds remain and selecting the wrong one is realistic, ask through `ask_prometheus_questions` with short candidate choices.

### 2. Confirm the live VitaShell endpoint
- VitaShell must be in FTP mode.
- Use the host and port visible on the Vita or already verified in the current session.
- `10.0.0.231:1337` is Raul's commonly observed endpoint, but it is only a remembered default.
- If connection fails, do not guess or scan the network. Ask for the endpoint VitaShell currently displays.
- VitaShell normally accepts anonymous FTP login.

### 3. Choose the remote destination
- For installable VPKs, default to `ux0:/downloads/<artifact-name>.vpk` unless the user or project runbook specifies another path.
- Replacing the same destination is acceptable when the user explicitly asks for the latest version.
- Upload only. Do not install, delete, or launch the package unless separately requested.

### 4. Upload with Windows Python `ftplib`
- Activate `workspace_write` and use bounded `workspace_run(action:"run")` execution.
- Use the bundled `templates/upload_and_verify_vita_ftp.py` with explicit host, port, local path, and remote path arguments.
- Transfer in binary mode, use a finite timeout, and close the connection cleanly.
- Never print credentials.
- Do not use WSL for the FTP transfer.

### 5. Verify independently
- After `STOR` completes, open a fresh FTP connection.
- Query remote `SIZE` if supported.
- Retrieve the remote file with `RETR` into a temporary local file.
- Compare local and retrieved byte sizes and SHA-256 hashes.
- Delete the temporary verification copy.
- Require exact equality before declaring success. A successful `STOR` response or matching size alone is insufficient.

### 6. Report clearly
Include:
- Local artifact path
- Vita destination path
- Exact byte size
- SHA-256
- Explicit byte-for-byte verification outcome
- The next step, normally: `Ready to install in VitaShell.`

### 7. Preserve continuity
After a successful meaningful deployment, call `write_note` with the local path, remote path, byte size, SHA-256, and verification result.

## Recovery and safety
- Never claim upload success without a completed FTP transfer.
- Never claim verification without retrieving and hashing the Vita copy.
- If verification disconnects, reconnect and retry the retrieval once. If it fails again, report the exact blocker.
- Do not rebuild unless the user requested a build or no valid artifact exists.
- Do not touch unrelated files or dirty work.
- Keep the known-good local artifact intact if the transfer fails.

## Completion standard
The requested local artifact exists at the requested Vita path and a fresh retrieved copy matches its exact size and SHA-256.
