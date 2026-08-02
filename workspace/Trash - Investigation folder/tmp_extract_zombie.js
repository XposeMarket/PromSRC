const fs=require('fs');
const { PNG }=require('pngjs');
const input='uploads/C691D9FE-95D0-4108-871E-674034DDC0CE.png';
const outputDir='downloads/zombie-assets';
fs.mkdirSync(outputDir,{recursive:true});
const png=PNG.sync.read(fs.readFileSync(input));
let trans=0, opaque=0, minA=255, maxA=0;
for(let i=3;i<png.data.length;i+=4){ const a=png.data[i]; if(a===0) trans++; if(a===255) opaque++; if(a<minA) minA=a; if(a>maxA) maxA=a; }
console.log(JSON.stringify({width:png.width,height:png.height,transparentPixels:trans,opaquePixels:opaque,totalPixels:png.width*png.height,minAlpha:minA,maxAlpha:maxA},null,2));
