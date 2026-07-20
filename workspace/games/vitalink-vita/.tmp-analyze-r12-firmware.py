#!/usr/bin/env python3
"""Read-only offline inspection of the R12-retrieved NPXS10026 executable."""
from pathlib import Path
import hashlib

p = Path("reports/r12-firmware-retrieval/vs0__app__NPXS10026__eboot.bin")
d = p.read_bytes()
terms = [b"SceBt", b"Bluetooth", b"ksceBt", b"SceSettings", b"Settings", b"NPXS10026", b"HID", b"L2CAP", b"Pair"]
lines = [
    f"path={p.as_posix()}",
    f"size={len(d)}",
    f"sha256={hashlib.sha256(d).hexdigest()}",
    f"header_hex={d[:32].hex()}",
    f"elf_magic_offset={d.find(bytes([0x7f])+b'ELF')}",
    f"sce_magic_offset={d.find(bytes([0x7f])+b'SCE')}",
]
for term in terms:
    offsets=[]
    start=0
    while True:
        pos=d.find(term,start)
        if pos < 0: break
        offsets.append(pos)
        start=pos+1
        if len(offsets)>=32: break
    lines.append(f"term={term.decode('ascii')} offsets={offsets}")
Path("reports/r12-firmware-retrieval/offline-analysis.txt").write_text("\n".join(lines)+"\n", encoding="utf-8")
print("\n".join(lines))
