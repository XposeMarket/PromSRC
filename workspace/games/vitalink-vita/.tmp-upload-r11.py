#!/usr/bin/env python3
from ftplib import FTP
from pathlib import Path
import hashlib

HOST, PORT = "10.0.0.231", 1337
LOCAL = Path("deploy/vitalink_bt_probe_kernel.skprx")
REMOTE = "ur0:/tai/vitalink_bt_probe_kernel.skprx"
VERIFY = Path("reports/r11-deploy-verify/vitalink_bt_probe_kernel.skprx")
VERIFY.parent.mkdir(parents=True, exist_ok=True)

data = LOCAL.read_bytes()
print(f"LOCAL size={len(data)} sha256={hashlib.sha256(data).hexdigest()}")
ftp = FTP()
ftp.connect(HOST, PORT, timeout=20)
ftp.login()
with LOCAL.open("rb") as f:
    print(f"UPLOAD {ftp.storbinary(f'STOR {REMOTE}', f)}")
try: ftp.quit()
except Exception: ftp.close()

ftp = FTP()
ftp.connect(HOST, PORT, timeout=20)
ftp.login()
with VERIFY.open("wb") as f:
    ftp.retrbinary(f"RETR {REMOTE}", f.write)
try: ftp.quit()
except Exception: ftp.close()
retrieved = VERIFY.read_bytes()
print(f"RETRIEVED size={len(retrieved)} sha256={hashlib.sha256(retrieved).hexdigest()}")
if retrieved != data:
    raise SystemExit("VERIFY_MISMATCH")
print("VERIFY_EXACT_MATCH")
