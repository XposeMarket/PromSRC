from pathlib import Path
import sys
from PIL import Image

video_path = Path('workspace/downloads/x_fetch_media/videos/polsia-main-promo.mp4')
out_dir = Path('workspace/downloads/x_fetch_media/videos/polsia-analysis-frames/manual')
out_dir.mkdir(parents=True, exist_ok=True)
print('PIL ok')
