#!/usr/bin/env python3
"""Read-only offline container analysis for exact R12 wlanbt retrieval."""
from pathlib import Path
import hashlib
src=Path("reports/r12-firmware-retrieval/os0__kd__wlanbt_robin_img_ax.skprx")
d=src.read_bytes()
elf_at=d.find(bytes([0x7f])+b"ELF")
terms=[b"SceBt",b"ksceBt",b"Bluetooth",b"HID",b"L2CAP",b"RegisterCallback",b"ReadEvent"]
lines=[f"path={src.as_posix()}",f"size={len(d)}",f"sha256={hashlib.sha256(d).hexdigest()}",f"header_hex={d[:64].hex()}",f"embedded_elf_offset={elf_at}"]
for term in terms:
    offsets=[]; pos=0
    while True:
        pos=d.find(term,pos)
        if pos<0:break
        offsets.append(pos);pos+=1
        if len(offsets)==32:break
    lines.append(f"term={term.decode('ascii')} offsets={offsets}")
if elf_at>=0:
    elf=src.with_suffix(".embedded.elf")
    elf.write_bytes(d[elf_at:])
    lines.append(f"embedded_elf={elf.name} size={elf.stat().st_size} sha256={hashlib.sha256(elf.read_bytes()).hexdigest()}")
Path("reports/r12-firmware-retrieval/wlanbt-container-analysis.txt").write_text("\n".join(lines)+"\n",encoding="utf-8")
print("\n".join(lines))
