#!/usr/bin/env python3
"""R12 read-only VitaShell FTP enumeration/retrieval; never issues STOR, DELE, RNFR/RNTO."""
from ftplib import FTP
from pathlib import Path
import hashlib

HOST, PORT = "10.0.0.231", 1337
LIST_PATHS = ["", "vs0:", "vs0:/sys", "vs0:/sys/external", "vs0:/app", "vs0:/app/NPXS10015"]
REMOTE_FILES = [
    "vs0:sys/external/libSceBt.suprx",
    "vs0:sys/external/libSceBtAvrcp.suprx",
    "vs0:app/NPXS10015/sce_module/libSceSettings.suprx",
    "vs0:app/NPXS10015/sce_module/eboot.bin",
]
out_dir = Path("reports/r12-retrieval")
out_dir.mkdir(parents=True, exist_ok=True)
summary = []

def record(text):
    print(text)
    summary.append(text)

ftp = FTP()
try:
    ftp.connect(HOST, PORT, timeout=12)
    ftp.login()
    record(f"CONNECTED host={HOST} port={PORT}")
    for remote_dir in LIST_PATHS:
        entries = []
        try:
            ftp.retrlines(f"LIST {remote_dir}", entries.append)
            record(f"LIST_OK remote={remote_dir or '/'} entries={len(entries)}")
            for entry in entries:
                record(f"LIST_ENTRY remote={remote_dir or '/'} value={entry}")
        except Exception as exc:
            record(f"LIST_ERROR remote={remote_dir or '/'} error={type(exc).__name__}:{exc}")

    for remote in REMOTE_FILES:
        local = out_dir / remote.replace(":/", "__").replace("/", "__")
        try:
            size = ftp.size(remote)
        except Exception as exc:
            size = f"UNAVAILABLE:{type(exc).__name__}:{exc}"
        try:
            with local.open("wb") as f:
                ftp.retrbinary(f"RETR {remote}", f.write)
        except Exception as exc:
            local.unlink(missing_ok=True)
            record(f"RETR_ERROR remote={remote} size={size} error={type(exc).__name__}:{exc}")
        else:
            data = local.read_bytes()
            record(f"RETRIEVED remote={remote} local={local.name} size={len(data)} sha256={hashlib.sha256(data).hexdigest()}")
except Exception as exc:
    record(f"CONNECT_OR_LOGIN_ERROR error={type(exc).__name__}:{exc}")
finally:
    try:
        ftp.quit()
    except Exception:
        try: ftp.close()
        except Exception: pass

(out_dir / "retrieval-summary.txt").write_text("\n".join(summary) + "\n", encoding="utf-8")
