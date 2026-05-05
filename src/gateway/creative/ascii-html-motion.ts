export type AsciiSourceCanvasOptions = {
  id?: string;
  sourceAssetId?: string;
  sourceUrl?: string;
  start?: number;
  duration?: number;
  glyphSet?: string;
  palette?: string;
  reveal?: string;
  density?: number;
  glitch?: number;
  bloom?: number;
  fit?: string;
};

export type AsciiSourceCanvasParts = {
  html: string;
  css: string;
  js: string;
  assetPlaceholders: string[];
};

function escapeAttr(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeId(value: unknown, fallback: string): string {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function sanitizeAssetId(value: unknown, fallback: string): string {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function assetRef(assetId: string, sourceUrl = ''): string {
  const explicit = String(sourceUrl || '').trim();
  if (explicit) return explicit;
  return `{{asset.${assetId}}}`;
}

export function renderAsciiSourceCanvasParts(options: AsciiSourceCanvasOptions = {}): AsciiSourceCanvasParts {
  const id = sanitizeId(options.id, 'ascii-source-canvas');
  const mediaId = `${id}-media`;
  const videoId = `${id}-video`;
  const sourceAssetId = sanitizeAssetId(options.sourceAssetId, 'source');
  const source = assetRef(sourceAssetId, options.sourceUrl);
  const start = clampNumber(options.start, 0, 0, 120);
  const duration = clampNumber(options.duration, 6, 0.1, 120);
  const density = clampNumber(options.density, 0.72, 0.1, 1);
  const glitch = clampNumber(options.glitch, 0.45, 0, 1);
  const bloom = clampNumber(options.bloom, 0.65, 0, 1);
  const glyphSet = sanitizeId(options.glyphSet, 'ascii').toLowerCase();
  const palette = sanitizeId(options.palette, 'neon').toLowerCase();
  const reveal = sanitizeId(options.reveal, 'scramble').toLowerCase();
  const fit = sanitizeId(options.fit, 'cover').toLowerCase();

  return {
    assetPlaceholders: sourceUrlToPlaceholders(source),
    html: `<div id="${escapeAttr(id)}-wrap" class="prom-block prom-ascii-source" data-role="ascii-source" data-start="${start}s" data-duration="${duration}s"><img id="${escapeAttr(mediaId)}" class="prom-ascii-source__media" src="${escapeAttr(source)}" alt="" crossorigin="anonymous" decoding="async"><video id="${escapeAttr(videoId)}" class="prom-ascii-source__media" src="${escapeAttr(source)}" data-start="${start}s" data-duration="${duration}s" muted playsinline preload="auto" crossorigin="anonymous"></video><canvas id="${escapeAttr(id)}" class="prom-ascii-source__canvas" data-role="ascii-source-canvas" data-start="${start}s" data-duration="${duration}s" data-ascii-glyph-set="${escapeAttr(glyphSet)}" data-ascii-palette="${escapeAttr(palette)}" data-ascii-reveal="${escapeAttr(reveal)}" data-ascii-density="${density}" data-ascii-glitch="${glitch}" data-ascii-bloom="${bloom}" data-ascii-fit="${escapeAttr(fit)}"></canvas><div class="prom-ascii-source__scan"></div><div class="prom-ascii-source__glass"></div></div>`,
    css: `.prom-ascii-source{position:absolute;inset:0;overflow:hidden;background:#010203;contain:layout paint size}.prom-ascii-source__media{position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none}.prom-ascii-source__canvas{position:absolute;inset:0;width:100%;height:100%;display:block;background:#010203}.prom-ascii-source__scan{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(to bottom,rgba(255,255,255,.08) 0 1px,transparent 1px 4px),radial-gradient(circle at 50% 45%,transparent 42%,rgba(0,0,0,.72) 100%);mix-blend-mode:screen;opacity:.6}.prom-ascii-source__glass{position:absolute;inset:-2%;pointer-events:none;background:linear-gradient(120deg,transparent 0 40%,rgba(255,255,255,.08) 48%,transparent 56%);mix-blend-mode:screen;animation:prom-ascii-glass 4.8s linear infinite}@keyframes prom-ascii-glass{from{transform:translateX(-70%)}to{transform:translateX(70%)}}`,
    js: renderAsciiSourceCanvasScript(id, mediaId, videoId, { start, duration }),
  };
}

function sourceUrlToPlaceholders(source: string): string[] {
  const refs = [
    ...Array.from(source.matchAll(/\{\{\s*asset\.([a-z0-9_-]+)\s*\}\}/gi)).map((match) => match[1]),
    ...Array.from(source.matchAll(/\{\{\s*(?!asset\.)([a-z0-9_-]+)\s*\}\}/gi)).map((match) => match[1]),
  ];
  return [...new Set(refs.map((ref) => sanitizeAssetId(ref, '')).filter(Boolean))];
}

function renderAsciiSourceCanvasScript(id: string, imageId: string, videoId: string, timing: { start: number; duration: number }): string {
  const json = JSON.stringify({ id, imageId, videoId, start: timing.start, duration: timing.duration }).replace(/</g, '\\u003c');
  return `<script>(function(){
    var cfg=${json};
    var canvas=document.getElementById(cfg.id);if(!canvas)return;
    var ctx=canvas.getContext('2d',{alpha:false});
    var img=document.getElementById(cfg.imageId);
    var vid=document.getElementById(cfg.videoId);
    var sample=document.createElement('canvas');
    var sctx=sample.getContext('2d',{willReadFrequently:true});
    var glyphs={
      ascii:' .,:;irsXA253hMHGS#9B&@',
      binary:' 0011010111001011110',
      blocks:' .:-=+*#%@',
      braille:' \\u2801\\u2803\\u2807\\u2817\\u2837\\u2877\\u28ff',
      katakana:' .-+*\\u30a2\\u30ab\\u30b5\\u30bf\\u30ca\\u30cf\\u30de\\u30e4\\u30e9\\u30ef'
    };
    var palettes={
      neon:[[0,240,255],[255,43,214],[212,255,58],[255,184,77]],
      phosphor:[[57,255,20],[153,255,122],[207,255,194],[26,116,48]],
      mono:[[236,241,255],[155,171,196],[77,92,128],[255,255,255]],
      inferno:[[255,209,102],[255,100,72],[189,53,255],[0,240,255]]
    };
    function num(name,fallback){var n=Number(canvas.getAttribute(name));return Number.isFinite(n)?n:fallback}
    var density=num('data-ascii-density',.72),glitch=num('data-ascii-glitch',.45),bloom=num('data-ascii-bloom',.65);
    var glyphSet=canvas.getAttribute('data-ascii-glyph-set')||'ascii';
    var paletteName=canvas.getAttribute('data-ascii-palette')||'neon';
    var reveal=canvas.getAttribute('data-ascii-reveal')||'scramble';
    var fit=canvas.getAttribute('data-ascii-fit')||'cover';
    var chars=(glyphs[glyphSet]||glyphs.ascii).split('');
    var colors=palettes[paletteName]||palettes.neon;
    function hash(x,y,t){var n=Math.sin(x*127.1+y*311.7+t*17.13)*43758.5453123;return n-Math.floor(n)}
    function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
    function smooth(a,b,x){x=clamp((x-a)/(b-a),0,1);return x*x*(3-2*x)}
    function mediaReady(){if(vid&&vid.readyState>=2&&Number.isFinite(vid.videoWidth)&&vid.videoWidth>0)return vid;if(img&&img.complete&&img.naturalWidth>0)return img;return null}
    function coverDraw(target,source,W,H){var sw=source.videoWidth||source.naturalWidth||source.width||1;var sh=source.videoHeight||source.naturalHeight||source.height||1;var scale=fit==='contain'?Math.min(W/sw,H/sh):Math.max(W/sw,H/sh);var dw=sw*scale,dh=sh*scale;target.drawImage(source,(W-dw)/2,(H-dh)/2,dw,dh)}
    function drawFallback(target,W,H,t){var g=target.createRadialGradient(W*.5,H*.48,8,W*.5,H*.48,Math.max(W,H)*.56);g.addColorStop(0,'#30493a');g.addColorStop(.48,'#061316');g.addColorStop(1,'#010203');target.fillStyle=g;target.fillRect(0,0,W,H);target.font='900 '+Math.max(16,Math.round(H*.2))+'px Arial';target.textAlign='center';target.textBaseline='middle';target.fillStyle='rgba(255,255,255,.9)';target.fillText('SOURCE',W/2,H*.5+Math.sin(t*2)*H*.04)}
    function colorAt(intensity,edge,r,g,b,x,y,t){
      var base=colors[Math.floor((intensity*(colors.length-1)+edge*2+hash(x,y,0)*.7))%colors.length];
      var sourceWeight=clamp(.28+intensity*.45,0,0.72);
      var pulse=.82+.18*Math.sin(t*3+x*.07+y*.05);
      var rr=Math.round((base[0]*(1-sourceWeight)+r*sourceWeight)*pulse);
      var gg=Math.round((base[1]*(1-sourceWeight)+g*sourceWeight)*pulse);
      var bb=Math.round((base[2]*(1-sourceWeight)+b*sourceWeight)*pulse);
      return 'rgba('+rr+','+gg+','+bb+','+clamp(.28+intensity*.95+edge*.28,0,1).toFixed(3)+')';
    }
    function buildValues(pixels,cols,rows){
      var count=cols*rows, values=new Float32Array(count), minA=255, maxA=0;
      for(var n=0;n<count;n++){var i=n*4;var a=pixels[i+3];if(a<minA)minA=a;if(a>maxA)maxA=a}
      var hasAlphaShape=minA<245&&maxA>40;
      var positives=[];
      for(var y=0;y<rows;y++){
        for(var x=0;x<cols;x++){
          var n=y*cols+x,i=n*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2],a=pixels[i+3]/255;
          var hi=Math.max(r,g,b),lo=Math.min(r,g,b);
          var lum=(.2126*r+.7152*g+.0722*b)/255;
          var sat=(hi-lo)/255;
          var v=hasAlphaShape?(a<.04?0:clamp(a*.78+sat*.52+lum*.28,0,1)):clamp(Math.max(lum,sat*.88),0,1);
          values[n]=v;
          if(v>.015)positives.push(v);
        }
      }
      if(positives.length>8){
        positives.sort(function(a,b){return a-b});
        var lo=positives[Math.floor(positives.length*.05)]||0;
        var hi=positives[Math.floor(positives.length*.97)]||1;
        if(hi-lo<.08)hi=lo+.08;
        for(var k=0;k<count;k++){values[k]=values[k]>.015?Math.pow(clamp((values[k]-lo)/(hi-lo),0,1),.72):0}
      }
      return {values:values,hasAlphaShape:hasAlphaShape};
    }
    function draw(time){
      var rect=canvas.getBoundingClientRect();
      var W=canvas.width=Math.max(1,Math.round(rect.width||canvas.clientWidth||1080));
      var H=canvas.height=Math.max(1,Math.round(rect.height||canvas.clientHeight||1920));
      var local=clamp((time-cfg.start)/cfg.duration,0,1);
      ctx.fillStyle='#010203';ctx.fillRect(0,0,W,H);
      var cell=Math.max(12,Math.round(34-density*17));
      var cols=Math.max(12,Math.floor(W/cell));
      var rows=Math.max(12,Math.floor(H/(cell*1.18)));
      sample.width=cols;sample.height=rows;
      var src=mediaReady();sctx.clearRect(0,0,cols,rows);
      if(src)coverDraw(sctx,src,cols,rows);else drawFallback(sctx,cols,rows,time);
      var pixels;try{pixels=sctx.getImageData(0,0,cols,rows).data}catch(e){drawFallback(sctx,cols,rows,time);pixels=sctx.getImageData(0,0,cols,rows).data}
      var valuePack=buildValues(pixels,cols,rows), values=valuePack.values;
      ctx.font='900 '+Math.round(cell*1.12)+'px Courier New,Consolas,monospace';
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowBlur=10+bloom*22;ctx.globalCompositeOperation='source-over';
      var revealBias=reveal==='scan'?local*1.4-.1:reveal==='iris'?smooth(0,1,local):local;
      for(var y=0;y<rows;y++){
        for(var x=0;x<cols;x++){
          var n=y*cols+x,i=n*4;
          var raw=values[n];
          var rx=Math.min(cols-1,x+1),dy=Math.min(rows-1,y+1);
          var edge=Math.min(1,Math.abs(raw-values[y*cols+rx])*3.4+Math.abs(raw-values[dy*cols+x])*3.4);
          var wave=.06*Math.sin(x*.31+y*.19+time*2.4);
          var noise=hash(x,y,Math.floor(time*12));
          var radius=Math.hypot((x/cols-.5)*1.2,(y/rows-.5));
          var gate=reveal==='iris'?smooth(.78,.08,radius+(1-local)*.8):reveal==='scan'?smooth(y/rows-.2,y/rows+.18,revealBias):smooth(noise*.5,1,local*1.22);
          var intensity=clamp(raw*1.18+edge*.82+wave,0,1);
          var glitchHit=glitch>0&&hash(x,y,Math.floor(time*18))>.987-glitch*.012;
          if(gate<.05&&reveal==='scramble'){intensity*=.22;glitchHit=hash(x,y,Math.floor(time*20))>.88}
          if(intensity<.12&&!glitchHit)continue;
          var r=pixels[i],g=pixels[i+1],b=pixels[i+2];
          var idx=glitchHit?Math.floor(hash(y,x,time)*chars.length):Math.floor(clamp(intensity+gate*.15,0,1)*(chars.length-1));
          var px=(x+.5)*W/cols,py=(y+.5)*H/rows;
          if(glitchHit)px+=(hash(x,y,time)-.5)*cell*glitch*5.5;
          ctx.fillStyle=colorAt(intensity,edge,r,g,b,x,y,time);
          ctx.shadowColor=edge>.24?'#ffffff':paletteName==='phosphor'?'#39ff14':'#00f0ff';
          ctx.fillText(chars[idx]||'#',px,py);
        }
      }
      ctx.shadowBlur=0;ctx.globalCompositeOperation='screen';
      var grad=ctx.createRadialGradient(W*.5,H*.48,0,W*.5,H*.48,Math.max(W,H)*.62);
      grad.addColorStop(0,'rgba(255,255,255,.12)');grad.addColorStop(.55,'rgba(0,240,255,.045)');grad.addColorStop(1,'rgba(0,0,0,.34)');
      ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);ctx.globalCompositeOperation='source-over';
      for(var k=0;k<Math.round(18+glitch*30);k++){if(hash(k,3,Math.floor(time*10))>.76){var yy=hash(k,7,Math.floor(time*8))*H;ctx.fillStyle=k%2?'rgba(255,43,214,.13)':'rgba(0,240,255,.12)';ctx.fillRect(0,yy,W,1+hash(k,11,time)*3)}}
    }
    function tick(evt){var t=evt&&evt.detail?Number(evt.detail.timeSeconds):Number(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__);draw(Number.isFinite(t)?t:performance.now()/1000)}
    if(img){img.addEventListener('load',tick);img.addEventListener('error',tick)}
    if(vid){vid.addEventListener('loadeddata',tick);vid.addEventListener('seeked',tick)}
    window.addEventListener('prometheus-html-motion-seek',tick);tick();
  })();</script>`;
}
