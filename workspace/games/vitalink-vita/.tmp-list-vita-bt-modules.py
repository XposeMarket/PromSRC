#!/usr/bin/env python3
from ftplib import FTP
HOST, PORT = "10.0.0.231", 1337
paths = [
    "vs0:/sys/external",
    "vs0:/sys/external/libbt.suprx",
    "vs0:/sys/external/libbtd.suprx",
    "vs0:/sys/external/bt.suprx",
    "vs0:/sys/external/bt_service.suprx",
    "vs0:/sys/external/SceBt.suprx",
    "vs0:/sys/external/SceBtForDriver.skprx",
    "vs0:/sys/external/bt.skprx",
    "vs0:/sys/external/bt_service.skprx",
    "vs0:/sys/external/btstack.skprx",
    "vs0:/sys/external/btif.skprx",
    "vs0:/app/NPXS10015",
]
ftp = FTP()
ftp.connect(HOST, PORT, timeout=15)
ftp.login()
for path in paths:
    print(f"\n### {path}")
    try:
        entries = []
        ftp.retrlines(f"LIST {path}", entries.append)
        for line in entries[:300]:
            if "bt" in line.lower() or path != "vs0:/sys/external":
                print(line)
        if not entries:
            print("EMPTY")
    except Exception as exc:
        print(f"ERROR {type(exc).__name__}: {exc}")
try:
    ftp.quit()
except Exception:
    ftp.close()
