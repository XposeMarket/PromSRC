import json
import subprocess
from pathlib import Path

ROOT = Path.cwd()
SOURCE = next((ROOT / 'downloads' / 'media').glob('*.mp4'))
TRANSCRIPT = next((ROOT / 'downloads' / 'media' / 'transcript').glob('*.json'))
OUT = ROOT / 'exports' / 'kimi-k3-social-clips'
OUT.mkdir(parents=True, exist_ok=True)
FFMPEG = r'C:\Users\rafel\OneDrive\Documents\Prometheus\Prometheus\node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe'

# Independent hooks: model claim, benchmark disruption, and real-world game test.
CLIPS = [
    ('01-kimi-k3-is-not-a-normal-model', 0.62, 38.66, 'KIMI K3 IS NOT A NORMAL MODEL'),
    ('02-open-models-are-catching-up-fast', 132.34, 204.16, 'OPEN MODELS ARE CATCHING UP FAST'),
    ('03-ai-tried-to-build-minecraft', 430.38, 471.66, 'AI TRIED TO BUILD MINECRAFT'),
]

segments = json.loads(TRANSCRIPT.read_text(encoding='utf-8'))['segments']

def ass_time(s):
    h = int(s // 3600); m = int((s % 3600) // 60); sec = s % 60
    return f'{h}:{m:02d}:{sec:05.2f}'

def clean(text):
    return ' '.join(text.strip().split()).replace('{', '(').replace('}', ')')

def escape(p):
    # ffmpeg filter parser is hostile to Windows drive paths.
    return str(p).replace('\\', '/').replace(':', '\\:').replace("'", "\\'")

def make_ass(start, end, title, path):
    lines = [
        '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 720', 'PlayResY: 1280', 'WrapStyle: 0',
        '', '[V4+ Styles]',
        'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
        'Style: Caption,Arial,42,&H00FFFFFF,&H0000D7FF,&H00101010,&H9A000000,1,0,0,0,100,100,0,0,1,3,1,2,34,34,210,1',
        'Style: Title,Arial,25,&H0000D7FF,&H0000D7FF,&H00101010,&H9A000000,1,0,0,0,100,100,1,0,1,2,1,8,30,30,36,1',
        'Style: Tag,Arial,18,&H00F2F2F2,&H00F2F2F2,&H00101010,&H9A000000,0,0,0,0,100,100,0,0,1,1,0,8,30,30,76,1',
        '', '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
        f'Dialogue: 1,0:00:00.00,{ass_time(end-start)},Title,,0,0,0,,{title}',
        f'Dialogue: 1,0:00:00.00,{ass_time(end-start)},Tag,,0,0,0,,@ashen_one  •  FULL VIDEO CLIPPED BY PROMETHEUS',
    ]
    for seg in segments:
        a, b = max(start, float(seg['start'])), min(end, float(seg['end']))
        if b <= a: continue
        # Keep on-screen text succinct and readable on a phone.
        text = clean(seg['text'])
        if not text: continue
        rel_a, rel_b = a-start, b-start
        lines.append(f'Dialogue: 2,{ass_time(rel_a)},{ass_time(rel_b)},Caption,,0,0,0,,{text}')
    path.write_text('\n'.join(lines), encoding='utf-8')

for slug, start, end, title in CLIPS:
    ass = OUT / f'{slug}.ass'
    mp4 = OUT / f'{slug}.mp4'
    make_ass(start, end, title, ass)
    vf = (
        '[0:v]split=2[bgsrc][fgsrc];'
        '[bgsrc]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,'
        'gblur=sigma=30:steps=2,eq=brightness=-0.22:saturation=0.72[bg];'
        '[fgsrc]scale=720:405:force_original_aspect_ratio=decrease[fg];'
        '[bg][fg]overlay=(W-w)/2:290,drawbox=x=0:y=0:w=iw:h=106:color=0x050505@0.88:t=fill,'
        'drawbox=x=0:y=1165:w=iw:h=115:color=0x050505@0.92:t=fill,'
        f"subtitles='{escape(ass)}'"
    )
    cmd = [FFMPEG, '-y', '-ss', str(start), '-t', str(end-start), '-i', str(SOURCE),
           '-filter_complex', vf, '-map', '0:a?', '-c:v', 'libx264', '-preset', 'faster', '-crf', '20',
           '-r', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(mp4)]
    print('RENDERING', slug, flush=True)
    subprocess.run(cmd, check=True)
    print('DONE', mp4, flush=True)

print('EXPORT_DIR', OUT, flush=True)
