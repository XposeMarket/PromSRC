#!/usr/bin/env python3
from ftplib import FTP
from pathlib import Path
import json
HOST,PORT='10.0.0.231',1337
chains=[['vs0:'],['vs0:','app'],['vs0:','app','NPXS10015'],['vs0:','app','NPXS10015','sce_sys'],['vs0:','sys'],['vs0:','sys','external'],['vs0:','vsh'],['vs0:','vsh','module'],['os0:'],['os0:','kd']]
out={}
ftp=FTP(); ftp.connect(HOST,PORT,timeout=15); ftp.login()
try:
  for chain in chains:
    key='/'.join(chain)
    try:
      ftp.cwd('/')
      for segment in chain: ftp.cwd(segment)
      entries=[]; ftp.retrlines('LIST',entries.append)
      out[key]={'entries':entries}
      print('CHAIN_OK',key,'entries=',len(entries))
      for line in entries[:200]: print(' ',line)
    except Exception as e:
      out[key]={'error':f'{type(e).__name__}: {e}'}; print('CHAIN_ERROR',key,type(e).__name__,e)
finally:
  try: ftp.quit()
  except Exception: ftp.close()
Path('reports/r12-firmware-retrieval/cwd-listings.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
