from pathlib import Path
p=Path('web-ui/src/components/creative/editor/index.js')
text=p.read_text(encoding='utf-8')
old="import { createRenderer, hitTestScene } from './preview/renderer.js';"
new="import { clearPreviewMediaCache, createRenderer, hitTestScene } from './preview/renderer.js';"
if old not in text: raise SystemExit('creative renderer import anchor not found')
text=text.replace(old,new,1)
old2="""    if (_renderer)     { _renderer.dispose();     _renderer     = null; }
    if (_viewport)     { _viewport.dispose();     _viewport     = null; }
    layout.dispose();
"""
new2="""    if (_renderer)     { _renderer.dispose();     _renderer     = null; }
    if (_viewport)     { _viewport.dispose();     _viewport     = null; }
    clearPreviewMediaCache();
    layout.dispose();
"""
if old2 not in text: raise SystemExit('creative unmount cleanup anchor not found')
text=text.replace(old2,new2,1)
p.write_text(text,encoding='utf-8')

reg=Path('scripts/test-creative-preview-media-cache.mjs')
r=reg.read_text(encoding='utf-8')
r += "\nconst editor=fs.readFileSync('web-ui/src/components/creative/editor/index.js','utf8');\nassert.match(editor,/clearPreviewMediaCache, createRenderer/,'editor must import media-cache teardown');\nassert.match(editor,/clearPreviewMediaCache\\(\\);\\s*layout\\.dispose\\(\\)/,'unmount must release cached media');\n"
reg.write_text(r,encoding='utf-8')
print('creative media cache teardown wiring applied')