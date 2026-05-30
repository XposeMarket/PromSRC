from pathlib import Path
import cv2

video = Path('workspace/downloads/x_fetch_media/videos/polsia-main-promo.mp4')
out_dir = Path('workspace/downloads/x_fetch_media/videos/polsia-analysis-frames/cv2')
out_dir.mkdir(parents=True, exist_ok=True)
cap = cv2.VideoCapture(str(video))
fps = cap.get(cv2.CAP_PROP_FPS) or 30
frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
duration = frames / fps if fps else 0
print('fps', fps, 'frames', frames, 'duration', duration)
times = [0.5, 3, 7, 12, 18, 25, 34, 43, 52, 62, 74, max(0, duration - 1)]
for t in times:
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, frame = cap.read()
    if not ok:
        print('failed', t)
        continue
    file = out_dir / f"frame_{int(round(t*10)):04d}_{str(round(t,1)).replace('.', 'p')}s.jpg"
    cv2.imwrite(str(file), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(file)
cap.release()
