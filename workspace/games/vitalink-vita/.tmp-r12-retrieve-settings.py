#!/usr/bin/env python3
from ftplib import FTP
from pathlib import Path
import hashlib,json
HOST,PORT='10.0.0.231',1337
outdir=Path('reports/r12-firmware-retrieval'); outdir.mkdir(parents=True,exist_ok=True)
files=['eboot.bin','system_settings_core.suprx','peripherals_settings_plugin.rco','network_settings_plugin.rco','system_settings_plugin.rco']
log=[]
ftp=FTP(); ftp.connect(HOST,PORT,timeout=15); ftp.login()
try:
  ftp.cwd('/'); ftp.cwd('vs0:'); ftp.cwd('app')
  entries=[]; ftp.retrlines('LIST',entries.append); print('APP_LIST',len(entries))
  for name in files:
    local=outdir/('vs0__app__NPXS10015__'+name)
    try:
      with local.open('wb') as f: ftp.retrbinary('RETR NPXS10015/'+name,f.write)
      d=local.read_bytes(); item={'remote':'vs0:/app/NPXS10015/'+name,'local':str(local),'size':len(d),'sha256':hashlib.sha256(d).hexdigest()}; log.append(item); print('RETRIEVED',item)
    except Exception as e: local.unlink(missing_ok=True); print('RETR_ERROR',name,type(e).__name__,e)
finally:
  try: ftp.quit()
  except Exception: ftp.close()
(outdir/'settings-retrieval.json').write_text(json.dumps(log,indent=2),encoding='utf-8')
