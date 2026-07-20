#!/usr/bin/env python3
from ftplib import FTP
from pathlib import Path
import hashlib

HOST, PORT = "10.0.0.231", 1337
LOCAL = Path("deploy/vitalink_bt_probe_kernel.skprx")
REMOTE = "ur0:/tai/vitalink_bt_probe_kernel.skprx"
VERIFY = Path("reports/r4-retrieval/vitalink_bt_probe_kernel.skprx")
VERIFY.parent.mkdir(parents=True, exist_ok=True)

data = LOCAL.read_bytes()
local_hash = hashlib.sha256(data).hexdigest()
print(f"LOCAL size={len(data)} sha256={local_hash}")

ftp = FTP()
ftp.connect(HOST, PORT, timeout=15)
ftp.login()
with LOCAL.open("rb") as f:
    response = ftp.storbinary(f"STOR {REMOTE}", f)
print(f"UPLOAD {response}")
try:
    ftp.quit()
except Exception:
    ftp.close()

ftp = FTP()
ftp.connect(HOST, PORT, timeout=15)
ftp.login()
try:
    print(f"REMOTE_SIZE {ftp.size(REMOTE)}")
except Exception as exc:
    print(f"REMOTE_SIZE unavailable: {exc}")
with VERIFY.open("wb") as f:
    ftp.retrbinary(f"RETR {REMOTE}", f.write)
try:
    ftp.quit()
except Exception:
    ftp.close()

retrieved = VERIFY.read_bytes()
remote_hash = hashlib.sha256(retrieved).hexdigest()
print(f"RETRIEVED size={len(retrieved)} sha256={remote_hash}")
if retrieved != data:
    raise SystemExit("VERIFY_MISMATCH")
print("VERIFY_EXACT_MATCH")
