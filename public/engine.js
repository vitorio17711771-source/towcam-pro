/* Deterministic, non-generative RGB processing. No resizing or geometry changes.
 * All analysis is bounded; tile core pixels use only the corresponding source
 * pixel and immediate neighbors. Edge protection blends toward the exact input.
 */
export const clamp=(v,lo=0,hi=255)=>Math.min(hi,Math.max(lo,v));
const lum=(r,g,b)=>.2126*r+.7152*g+.0722*b;
const pct=(hist,n,q)=>{
  let sum=0; for(let i=0;i<256;i++){sum+=hist[i];if(sum>=n*q)return i;}return 255;
};

export function analyzeImage(data,width,height){
  const hist=new Uint32Array(256), cells=8;
  const sums=new Float64Array(cells*cells), counts=new Uint32Array(cells*cells);
  let total=0,sat=0,red=0,green=0,blue=0,neutral=0,edges=0,edgeSamples=0,noise=0,flat=0;
  const luma=new Float32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2],l=lum(r,g,b);
    const v=Math.round(l);hist[v]++;total+=l;luma[y*width+x]=l;
    const spread=Math.max(r,g,b)-Math.min(r,g,b);sat+=spread;
    const ci=Math.min(cells-1,Math.floor(y*cells/height))*cells+Math.min(cells-1,Math.floor(x*cells/width));
    sums[ci]+=l;counts[ci]++;
    // Neutral, midtone-biased evidence only. Strong paint colors and clipped
    // values are not used to estimate an illuminant.
    if(l>46&&l<215&&spread<43&&spread<l*.45){red+=r;green+=g;blue+=b;neutral++;}
  }
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x,l=luma[i],a=luma[i-1],b=luma[i+1],c=luma[i-width],d=luma[i+width];
    const grad=Math.max(Math.abs(a-b),Math.abs(c-d),Math.abs(l-a),Math.abs(l-b),Math.abs(l-c),Math.abs(l-d));
    edges+=grad;edgeSamples++;
    if(grad<15){noise+=Math.abs(l-(a+b+c+d)/4);flat++;}
  }
  const n=width*height||1,mean=total/n,p05=pct(hist,n,.05),p50=pct(hist,n,.5),p95=pct(hist,n,.95);
  let shadows=0,highlights=0,blackClip=0,whiteClip=0;
  for(let i=0;i<256;i++){if(i<55)shadows+=hist[i];if(i>220)highlights+=hist[i];if(i<=2)blackClip+=hist[i];if(i>=253)whiteClip+=hist[i];}
  const grid=Array.from(sums,(v,i)=>counts[i]?v/counts[i]:mean);
  const nr=neutral?red/neutral:128,ng=neutral?green/neutral:128,nb=neutral?blue/neutral:128;
  return {mean,p05,p50,p95,range:p95-p05,shadows:shadows/n,highlights:highlights/n,
    blackClip:blackClip/n,whiteClip:whiteClip/n,saturation:sat/n,noise:flat?noise/flat:0,
    edge:edgeSamples?edges/edgeSamples:0,neutralFraction:neutral/n,
    neutralRGB:[nr,ng,nb],warmth:nr-nb,grid,cells,hist:Array.from(hist)};
}

export function chooseProfile(a,profile='auto'){
  const night=a.mean<70||a.shadows>.64;
  const lowLight=night||a.mean<104||a.shadows>.44;
  const backlit=a.shadows>.22&&a.highlights>.13;
  const highContrast=a.range>170||backlit;
  const lowContrast=a.range<86;
  const artificial=lowLight&&Math.abs(a.warmth)>12&&a.neutralFraction>.12;
  const safe=profile==='faithful';
  const strength=safe?.36:1;
  const brighten=clamp((118-a.mean)/118,-.22,.65);
  const shadow=clamp(Math.max(0,brighten)*.28+a.shadows*.10+(backlit?.065:0),0,.25)*strength;
  const contrast=clamp((lowContrast?.18:.045)-(highContrast?.055:0),-.03,.19)*strength;
  const highlights=clamp(a.highlights*.18+(a.whiteClip>.02?.04:0)+Math.max(0,-brighten)*.12,0,.15)*strength;
  const nr=a.neutralRGB[0],ng=a.neutralRGB[1],nb=a.neutralRGB[2],neutral=(nr+ng+nb)/3;
  // Very conservative neutral correction: small offsets relative to luma,
  // gated by confidence. Saturated, clipped, and edge pixels receive less.
  const wbConfidence=clamp((a.neutralFraction-.08)*2.2,0,1)*strength*(artificial?.75:.5);
  const wb=[nr,ng,nb].map(v=>clamp((neutral-v)*wbConfidence,-6,6));
  // LUT has fixed black/white endpoints and monotonic slope, with no
  // attempt to invent clipped detail.
  const lut=new Float32Array(256);
  let previous=0;
  for(let i=0;i<256;i++){
    const t=i/255;
    const v=255*(t+shadow*4*t*(1-t)*(1-t)-highlights*4*t*t*(1-t)+contrast*4*t*(1-t)*(t-.5));
    lut[i]=previous=clamp(Math.max(previous,v));}
  lut[0]=0;lut[255]=255;
  return {label:safe?'Orijinallik':night?(artificial?'Gece · yapay ışık':'Gece'):backlit?'Ters ışık':lowLight?'Düşük ışık':highContrast?'Yüksek kontrast':artificial?'Yapay ışık':'Gündüz',
    lut,wb,sharp:strength*(night?.09:lowLight?.16:.24)*(a.edge>22?.75:1),
    lumaDenoise:strength*clamp((lowLight?.18:.045)+a.noise*.032,0,.30),
    chromaDenoise:strength*clamp((lowLight?.30:.08)+a.noise*.035,0,.45),
    vibrance:strength*clamp((42-a.saturation)/260,0,.10),
    local:strength*(highContrast?.05:lowContrast?.07:.025),
    mean:a.mean,grid:a.grid,cells:a.cells,night,lowLight};
}

// Smooth coarse illumination grid, not a blockwise contrast filter.
function localMean(p,x,y,w,h){
  const gx=clamp(x/w*p.cells-.5,0,p.cells-1),gy=clamp(y/h*p.cells-.5,0,p.cells-1);
  const ix=Math.floor(gx),iy=Math.floor(gy),dx=gx-ix,dy=gy-iy;
  const j=Math.min(p.cells-1,ix+1),k=Math.min(p.cells-1,iy+1);
  const a=p.grid[iy*p.cells+ix]*(1-dx)+p.grid[iy*p.cells+j]*dx;
  const b=p.grid[k*p.cells+ix]*(1-dx)+p.grid[k*p.cells+j]*dx;
  return a*(1-dy)+b*dy;
}

/**
 * input includes a one-pixel halo on every available side. Output contains
 * exactly the specified core, including alpha; the halo avoids tile seams.
 * Neither object positions nor pixel coordinates are changed.
 */
export function processTile(input,iw,ih,core,p,fullWidth,fullHeight){
  const {x,y,width,height,offsetX,offsetY}=core;
  const out=new Uint8ClampedArray(width*height*4);
  const L=new Float32Array(iw*ih);
  for(let j=0,i=0;j<L.length;j++,i+=4)L[j]=lum(input[i],input[i+1],input[i+2]);
  let protectedPixels=0;
  for(let yy=0;yy<height;yy++){
    const sy=yy+offsetY;
    for(let xx=0;xx<width;xx++){
      const sx=xx+offsetX,j=sy*iw+sx,i=j*4,o=(yy*width+xx)*4;
      const r=input[i],g=input[i+1],b=input[i+2],l=L[j];
      const j0=sx>0?j-1:j,j1=sx<iw-1?j+1:j,j2=sy>0?j-iw:j,j3=sy<ih-1?j+iw:j;
      const a=L[j0],bb=L[j1],c=L[j2],d=L[j3];
      let maxDiff=Math.max(Math.abs(l-a),Math.abs(l-bb),Math.abs(l-c),Math.abs(l-d),Math.abs(a-bb),Math.abs(c-d));
      if(maxDiff<46&&sx>0&&sx<iw-1&&sy>0&&sy<ih-1){maxDiff=Math.max(maxDiff,Math.abs(l-L[j-iw-1]),Math.abs(l-L[j-iw+1]),Math.abs(l-L[j+iw-1]),Math.abs(l-L[j+iw+1]));}
      // Detect chromatic edges as well as luminance edges (e.g. lettering
      // whose foreground/background have similar luminance).
      if(maxDiff<46){
        const p0=j0*4,p1=j1*4,p2=j2*4,p3=j3*4;
        maxDiff=Math.max(maxDiff,.8*Math.max(Math.abs(r-input[p0]),Math.abs(g-input[p0+1]),Math.abs(b-input[p0+2]),Math.abs(r-input[p1]),Math.abs(g-input[p1+1]),Math.abs(b-input[p1+2]),Math.abs(r-input[p2]),Math.abs(g-input[p2+1]),Math.abs(b-input[p2+2]),Math.abs(r-input[p3]),Math.abs(g-input[p3+1]),Math.abs(b-input[p3+2])));
      }
      // Strong edges (text, logos, badges, damage, license plates) are left
      // exactly as decoded; lower-contrast edges gradually receive less work.
      const protect=clamp((maxDiff-12)/34,0,1);
      if(protect>=1||l<=1||l>=254||input[i+3]===0){out[o]=r;out[o+1]=g;out[o+2]=b;out[o+3]=input[i+3];protectedPixels++;continue;}
      const safe=1-protect;
      const avg=(a+bb+c+d)/4,detail=l-avg;
      const lo=Math.floor(l),fraction=l-lo;
      let tone=p.lut[lo]*(1-fraction)+p.lut[Math.min(255,lo+1)]*fraction;
      const local=localMean(p,x+xx,y+yy,fullWidth,fullHeight);
      tone+=clamp((p.mean-local)*p.local,-6,6)*(4*(l/255)*(1-l/255));
      // Flat region denoising only: low luminance difference and small chroma
      // distance. Avoid replacing texture, fine lines, or colored edges.
      let cr=r-l,cg=g-l,cb=b-l;
      const flatWeight=clamp((12-maxDiff)/12,0,1);
      if(flatWeight>0){
        const ar=(input[j0*4]+input[j1*4]+input[j2*4]+input[j3*4])/4-avg;
        const ag=(input[j0*4+1]+input[j1*4+1]+input[j2*4+1]+input[j3*4+1])/4-avg;
        const ab=(input[j0*4+2]+input[j1*4+2]+input[j2*4+2]+input[j3*4+2])/4-avg;
        const cm=clamp(1-Math.max(Math.abs(cr-ar),Math.abs(cg-ag),Math.abs(cb-ab))/23,0,1)*flatWeight*p.chromaDenoise;
        cr+=(ar-cr)*cm;cg+=(ag-cg)*cm;cb+=(ab-cb)*cm;
        tone-=clamp(detail,-10,10)*flatWeight*p.lumaDenoise;
      }
      // Limited microcontrast and unsharp mask; no clipping/halo overshoot.
      tone+=clamp(detail,-8,8)*p.sharp*clamp((maxDiff-3)/10,0,1);
      const spread=Math.max(r,g,b)-Math.min(r,g,b);
      const neutralWeight=clamp(1-spread/75,0,1)*clamp(l/38,0,1)*clamp((255-l)/45,0,1);
      const saturation=1+p.vibrance*clamp(1-spread/125,0,1);
      cr=cr*saturation+p.wb[0]*neutralWeight;
      cg=cg*saturation+p.wb[1]*neutralWeight;
      cb=cb*saturation+p.wb[2]*neutralWeight;
      const residual=lum(cr,cg,cb);cr-=residual;cg-=residual;cb-=residual;
      tone=clamp(tone,1,254);
      // Fit chroma into gamut by scaling together instead of clipping
      // individual color channels (avoids color shifts in car paint).
      const hi=Math.max(cr,cg,cb),neg=Math.min(cr,cg,cb);
      const scale=Math.min(1,hi>0?(255-tone)/hi:1,neg<0?tone/-neg:1);
      out[o]=r+safe*(tone+cr*scale-r);
      out[o+1]=g+safe*(tone+cg*scale-g);
      out[o+2]=b+safe*(tone+cb*scale-b);
      out[o+3]=input[i+3];
    }
  }
  return {data:out,protectedPixels};
}
