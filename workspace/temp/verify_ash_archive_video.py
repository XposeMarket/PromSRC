from pathlib import Path
import cv2

video = Path('workspace/hyperframes-prometheus-ash-archive/prometheus-ash-archive.mp4')
out_dir = Path('workspace/hyperframes-prometheus-ash-archive/verification-frames')
out_dir.mkdir(parents=True, exist_ok=True)
cap = cv2.VideoCapture(str(video))
fps = cap.get(cv2.CAP_PROP_FPS) or 0
frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
duration = frames / fps if fps else 0
print(f'fps={fps}')
print(f'frames={frames}')
print(f'duration={duration}')
for t in [1, 8, 15, 22, 30, 38, 43]:
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, frame = cap.read()
    if not ok:
        print(f'failed={t}')
        continue
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    mean = float(gray.mean())
    std = float(gray.std())
    file = out_dir / f'frame_{t:02d}s.jpg'
    cv2.imwrite(str(file), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f'{file} mean={mean:.2f} std={std:.2f}')
cap.release()
