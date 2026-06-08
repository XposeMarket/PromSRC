import sys
from pathlib import Path
from math import ceil

try:
    import cv2
except Exception as e:
    print(f"ERROR: OpenCV/cv2 is not available: {e}", file=sys.stderr)
    sys.exit(2)

try:
    from PIL import Image, ImageDraw, ImageFont
except Exception as e:
    print(f"ERROR: Pillow/PIL is not available: {e}", file=sys.stderr)
    sys.exit(2)

if len(sys.argv) < 3:
    print("Usage: python make_contact_sheet.py <video> <output_png> [frames]", file=sys.stderr)
    sys.exit(1)

video_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])
frame_count_target = int(sys.argv[3]) if len(sys.argv) > 3 else 24

if not video_path.exists():
    print(f"ERROR: video not found: {video_path}", file=sys.stderr)
    sys.exit(1)

cap = cv2.VideoCapture(str(video_path))
if not cap.isOpened():
    print(f"ERROR: could not open video: {video_path}", file=sys.stderr)
    sys.exit(1)

total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
duration = (total_frames / fps) if total_frames and fps else 0

if total_frames <= 0:
    print("ERROR: video reports zero frames", file=sys.stderr)
    sys.exit(1)

n = max(1, min(frame_count_target, total_frames))
indices = []
if n == 1:
    indices = [0]
else:
    # sample evenly from first frame to final frame
    indices = [round(i * (total_frames - 1) / (n - 1)) for i in range(n)]

thumb_w = 320
label_h = 34
pad = 10
cols = 4 if n <= 24 else 5
rows = ceil(n / cols)

# choose a usable font
try:
    font = ImageFont.truetype("arial.ttf", 16)
    small_font = ImageFont.truetype("arial.ttf", 13)
except Exception:
    font = ImageFont.load_default()
    small_font = ImageFont.load_default()

thumbs = []
for seq, idx in enumerate(indices, start=1):
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    ok, frame = cap.read()
    if not ok or frame is None:
        continue
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    img = Image.fromarray(rgb)
    aspect = img.height / img.width if img.width else 9/16
    thumb_h = int(thumb_w * aspect)
    img = img.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)

    tile = Image.new("RGB", (thumb_w, thumb_h + label_h), (18, 18, 18))
    tile.paste(img, (0, 0))
    draw = ImageDraw.Draw(tile)
    seconds = idx / fps if fps else 0
    mm = int(seconds // 60)
    ss = seconds - mm * 60
    label = f"{seq:02d}  {mm:02d}:{ss:05.2f}  frame {idx}"
    draw.rectangle((0, thumb_h, thumb_w, thumb_h + label_h), fill=(10, 10, 10))
    draw.text((8, thumb_h + 8), label, fill=(238, 238, 238), font=small_font)
    thumbs.append(tile)

cap.release()

if not thumbs:
    print("ERROR: no frames extracted", file=sys.stderr)
    sys.exit(1)

# normalize tile heights to max
max_tile_h = max(t.height for t in thumbs)
tile_w = thumb_w
sheet_w = cols * tile_w + (cols + 1) * pad
header_h = 72
sheet_h = header_h + rows * max_tile_h + (rows + 1) * pad
sheet = Image.new("RGB", (sheet_w, sheet_h), (242, 240, 235))
draw = ImageDraw.Draw(sheet)

title = video_path.name
meta = f"{len(thumbs)} evenly sampled frames • {duration:.2f}s duration • {fps:.2f} fps • {total_frames} frames"
draw.text((pad, 12), title, fill=(20, 20, 20), font=font)
draw.text((pad, 40), meta, fill=(70, 70, 70), font=small_font)

for i, tile in enumerate(thumbs):
    r = i // cols
    c = i % cols
    x = pad + c * (tile_w + pad)
    y = header_h + pad + r * (max_tile_h + pad)
    # vertically align top; fill remainder subtly if different heights
    sheet.paste(tile, (x, y))

out_path.parent.mkdir(parents=True, exist_ok=True)
sheet.save(out_path, quality=95)
print(f"CONTACT_SHEET={out_path}")
print(f"FRAMES_EXTRACTED={len(thumbs)}")
print(f"DURATION_SECONDS={duration:.3f}")
print(f"FPS={fps:.3f}")
print(f"TOTAL_FRAMES={total_frames}")
