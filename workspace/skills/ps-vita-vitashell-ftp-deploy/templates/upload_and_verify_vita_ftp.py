#!/usr/bin/env python3
"""Upload one file to VitaShell FTP and verify it through a fresh RETR.

Usage:
  python upload_and_verify_vita_ftp.py HOST PORT LOCAL_PATH REMOTE_PATH
"""
from __future__ import annotations
from ftplib import FTP
from pathlib import Path
import hashlib
import os
import sys
import tempfile


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def connect(host: str, port: int) -> FTP:
    ftp = FTP()
    ftp.connect(host, port, timeout=20)
    ftp.login()
    ftp.voidcmd("TYPE I")
    return ftp


def close(ftp: FTP) -> None:
    try:
        ftp.quit()
    except Exception:
        ftp.close()


def main() -> int:
    if len(sys.argv) != 5:
        print("Usage: upload_and_verify_vita_ftp.py HOST PORT LOCAL_PATH REMOTE_PATH", file=sys.stderr)
        return 2

    host, port_text, local_text, remote_text = sys.argv[1:]
    port = int(port_text)
    local = Path(local_text).resolve()
    remote = remote_text.replace("\\", "/")
    if not local.is_file():
        raise FileNotFoundError(f"Local artifact not found: {local}")

    local_size = local.stat().st_size
    local_hash = digest(local)

    ftp = connect(host, port)
    try:
        with local.open("rb") as source:
            reply = ftp.storbinary(f"STOR {remote}", source, blocksize=1024 * 1024)
        if not reply.startswith("226"):
            raise RuntimeError(f"Upload did not complete cleanly: {reply}")
    finally:
        close(ftp)

    fd, temp_text = tempfile.mkstemp(prefix="vita-ftp-verify-", suffix=local.suffix)
    os.close(fd)
    retrieved = Path(temp_text)
    try:
        ftp = connect(host, port)
        try:
            try:
                remote_size = ftp.size(remote)
            except Exception:
                remote_size = None
            with retrieved.open("wb") as destination:
                reply = ftp.retrbinary(f"RETR {remote}", destination.write, blocksize=1024 * 1024)
            if not reply.startswith("226"):
                raise RuntimeError(f"Verification retrieval did not complete cleanly: {reply}")
        finally:
            close(ftp)

        retrieved_size = retrieved.stat().st_size
        retrieved_hash = digest(retrieved)
        verified = (
            retrieved_size == local_size
            and retrieved_hash == local_hash
            and (remote_size is None or remote_size == local_size)
        )
        print(f"LOCAL_PATH={local}")
        print(f"REMOTE_PATH={remote}")
        print(f"LOCAL_SIZE={local_size}")
        print(f"REMOTE_SIZE={remote_size if remote_size is not None else 'unsupported'}")
        print(f"RETRIEVED_SIZE={retrieved_size}")
        print(f"SHA256={local_hash}")
        print(f"RETRIEVED_SHA256={retrieved_hash}")
        print(f"VERIFIED={'true' if verified else 'false'}")
        return 0 if verified else 1
    finally:
        retrieved.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
