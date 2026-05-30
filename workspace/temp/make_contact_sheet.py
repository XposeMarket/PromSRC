from pathlib import Path
import cv2
import numpy as np

frames_dir = Path('workspace/hyperframes-prometheus-ash-archive/verification-frames')
files = sorted(frames_dir.glob('frame_*.jpg'))
imgs = []
for f in files:
    img = cv2.imread(str(f))
    img = cv2.resize(img, (480,270))
    label = f.stem.replace('frame_','')
    cv2.rectangle(img, (0,0), (140,36), (0,0,0), -1)
    cv2.putText(img, label, (12,25), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255,255,255), 2)
    imgs.append(img)
rows=[]
for i in range(0,len(imgs),2):
    row=imgs[i]
    if i+1<len(imgs): row=np.hstack([row,imgs[i+1]])
    else: row=np.hstack([row,np.zeros_like(row)])
    rows.append(row)
sheet=np.vstack(rows)
out=Path('workspace/hyperframes-prometheus-ash-archive/verification-frames/contact-sheet.jpg')
cv2.imwrite(str(out), sheet, [cv2.IMWRITE_JPEG_QUALITY, 92])
print(out)
