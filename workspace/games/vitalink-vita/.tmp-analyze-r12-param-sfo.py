#!/usr/bin/env python3
"""Read-only minimal parser for retrieved Vita PARAM.SFO metadata."""
from pathlib import Path
import struct, hashlib
p = Path("reports/r12-firmware-retrieval/vs0__app__NPXS10026__sce_sys__param.sfo")
d = p.read_bytes()
magic, version, key_off, data_off, count = struct.unpack_from("<IIIII", d, 0)
lines=[f"path={p.as_posix()}", f"size={len(d)}", f"sha256={hashlib.sha256(d).hexdigest()}", f"magic=0x{magic:08x}", f"version=0x{version:08x}", f"entries={count}"]
for i in range(count):
    base=20+i*16
    name_off, fmt, length, max_length, value_off=struct.unpack_from("<HHIII",d,base)
    key_end=d.find(b"\0",key_off+name_off)
    key=d[key_off+name_off:key_end].decode("ascii","replace")
    raw=d[data_off+value_off:data_off+value_off+length]
    value=raw.rstrip(b"\0").decode("utf-8","replace") if fmt in (0x0204, 0x0004) else raw.hex()
    lines.append(f"{key}={value}")
Path("reports/r12-firmware-retrieval/param-sfo-analysis.txt").write_text("\n".join(lines)+"\n",encoding="utf-8")
print("\n".join(lines))
