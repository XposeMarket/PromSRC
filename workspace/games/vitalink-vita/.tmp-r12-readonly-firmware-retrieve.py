#!/usr/bin/env python3
"""R12 read-only VitaShell FTP retrieval; never uses STOR/DELE/RNFR/RNTO."""
from ftplib import FTP
from pathlib import Path
import hashlib, json

HOST, PORT = "10.0.0.231", 1337
OUT = Path("reports/r12-firmware-retrieval")
OUT.mkdir(parents=True, exist_ok=True)
LIST_DIRS = ["", "vs0:", "vs0:/sys", "vs0:/sys/external", "vs0:/app", "vs0:/app/NPXS10026"]
CWD_DIRS = ["vs0:", "vs0:/app", "vs0:/app/NPXS10026", "vs0:/app/NPXS10026/sce_module"]
CANDIDATES = [
    "vs0:/app/NPXS10015/eboot.bin",
    "vs0:/app/NPXS10015/system_settings_core.suprx",
    "vs0:/app/NPXS10015/peripherals_settings_plugin.rco",
    "vs0:/app/NPXS10015/network_settings_plugin.rco",
    "vs0:/app/NPXS10015/system_settings_plugin.rco",
    "os0:kd/wlanbt_robin_img_ax.skprx",
    "os0:/kd/wlanbt_robin_img_ax.skprx",
]
log = {"host": HOST, "port": PORT, "listings": {}, "retrieved": [], "errors": []}

def connect():
    ftp = FTP(); ftp.connect(HOST, PORT, timeout=15); ftp.login(); return ftp

def note_error(prefix, remote, exc):
    msg = f"{prefix} {remote}: {type(exc).__name__}: {exc}"
    print(msg); log["errors"].append(msg)

ftp = connect()
try:
    for remote in LIST_DIRS:
        entries = []
        try:
            ftp.retrlines(f"LIST {remote}" if remote else "LIST", entries.append)
            log["listings"][remote or "/"] = entries
            print(f"LIST_OK {remote or '/'} entries={len(entries)}")
        except Exception as exc:
            note_error("LIST_ERROR", remote or "/", exc)
finally:
    try: ftp.quit()
    except Exception: ftp.close()

ftp = connect()
try:
    for remote in CWD_DIRS:
        entries = []
        try:
            ftp.cwd(remote)
            ftp.retrlines("LIST", entries.append)
            log["listings"][f"CWD:{remote}"] = entries
            print(f"CWD_LIST_OK {remote} entries={len(entries)}")
            for line in entries[:80]: print("  " + line)
        except Exception as exc:
            note_error("CWD_LIST_ERROR", remote, exc)
finally:
    try: ftp.quit()
    except Exception: ftp.close()

for remote in CANDIDATES:
    ftp = connect()
    local = OUT / remote.replace(":", "").replace("/", "__")
    try:
        with local.open("wb") as f: ftp.retrbinary(f"RETR {remote}", f.write)
        data = local.read_bytes()
        item = {"remote": remote, "local": str(local), "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        log["retrieved"].append(item)
        print(f"RETRIEVED {remote} size={item['size']} sha256={item['sha256']}")
    except Exception as exc:
        local.unlink(missing_ok=True); note_error("RETR_ERROR", remote, exc)
    finally:
        try: ftp.quit()
        except Exception: ftp.close()

(OUT / "retrieval-manifest-cwd.json").write_text(json.dumps(log, indent=2), encoding="utf-8")
