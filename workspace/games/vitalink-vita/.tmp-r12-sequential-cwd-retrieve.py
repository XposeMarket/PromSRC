#!/usr/bin/env python3
"""R12: read-only sequential CWD enumeration/retrieval. No remote mutations."""
from ftplib import FTP
from pathlib import Path
import hashlib, json

HOST, PORT = "10.0.0.231", 1337
OUT = Path("reports/r12-firmware-retrieval")
OUT.mkdir(parents=True, exist_ok=True)
log={"host":HOST,"port":PORT,"operations":"CWD/LIST/RETR only","listings":{},"retrieved":[],"errors":[]}

def conn():
    f=FTP(); f.connect(HOST,PORT,timeout=15); f.login(); return f

def descend_and_list(parts):
    f=conn(); label="/".join(parts)
    try:
        for p in parts: f.cwd(p)
        rows=[]; f.retrlines("LIST",rows.append)
        log["listings"][label]=rows
        print(f"LIST_OK {label} {len(rows)}")
        for r in rows[:120]: print("  "+r)
    except Exception as e:
        msg=f"LIST_ERROR {label} {type(e).__name__}:{e}"; log["errors"].append(msg); print(msg)
    finally:
        try:f.quit()
        except: f.close()

for path in [("vs0:",),("vs0:","app"),("vs0:","app","NPXS10015"),("vs0:","app","NPXS10015","sce_module"),("vs0:","sys"),("vs0:","sys","external"),("os0:",),("os0:","kd")]: descend_and_list(path)

candidates=[
 "vs0:/app/NPXS10015/eboot.bin", "vs0:/app/NPXS10015/sce_sys/param.sfo",
 "os0:/kd/wlanbt_robin_img_ax.skprx", "os0:/kd/wlanbt_robin_img.skprx",
]
for remote in candidates:
    f=conn(); local=OUT/remote.replace(":","").replace("/","__")
    try:
        with local.open("wb") as h:f.retrbinary("RETR "+remote,h.write)
        data=local.read_bytes(); item={"remote":remote,"local":str(local),"size":len(data),"sha256":hashlib.sha256(data).hexdigest()}
        log["retrieved"].append(item); print("RETRIEVED",item)
    except Exception as e:
        local.unlink(missing_ok=True); msg=f"RETR_ERROR {remote} {type(e).__name__}:{e}"; log["errors"].append(msg);print(msg)
    finally:
        try:f.quit()
        except:f.close()
(OUT/"retrieval-manifest-sequential-cwd.json").write_text(json.dumps(log,indent=2),encoding="utf-8")
