#!/usr/bin/env python3
from ftplib import FTP
from pathlib import Path
import hashlib

HOST, PORT = "10.0.0.231", 1337
REMOTE_FILES = [
    "ur0:/data/vitalink-gate2-r6-start.txt",
    "ur0:/data/vitalink/kernel-probe-r6.txt",
    "ur0:/tai/vitalink_bt_probe_kernel.skprx",
]
out_dir = Path("reports/r6-retrieval")
out_dir.mkdir(parents=True, exist_ok=True)

for remote in REMOTE_FILES:
    local = out_dir / remote.rsplit("/", 1)[-1]
    ftp = FTP()
    ftp.connect(HOST, PORT, timeout=12)
    ftp.login()
    try:
        with local.open("wb") as f:
            ftp.retrbinary(f"RETR {remote}", f.write)
    except Exception as exc:
        print(f"MISSING_OR_ERROR {remote}: {type(exc).__name__}: {exc}")
        local.unlink(missing_ok=True)
    else:
        data = local.read_bytes()
        print(f"RETRIEVED {remote} size={len(data)} sha256={hashlib.sha256(data).hexdigest()}")
        if local.suffix == ".txt":
            print("---CONTENT---")
            print(data.decode("utf-8", errors="replace").rstrip())
            print("---END---")
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()
