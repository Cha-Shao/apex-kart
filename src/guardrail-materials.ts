import * as THREE from 'three';

export const FENCE_METAL_TILE=.28;

/** Metre-scaled coating/zinc grain. One packed texture supplies height,
 * roughness and metalness, so wear stays aligned across all PBR channels. */
export function guardrailPostMaterial(painted:boolean){
  const size=256,color=new Uint8Array(size*size*4),surface=new Uint8Array(size*size*4);let seed=painted?1847:7823;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const fields=[8,32,64].map(n=>({n,values:Float32Array.from({length:n*n},random)}));
  const noise=(x:number,y:number,field:typeof fields[number])=>{
    const {n,values}=field,px=x/size*n,py=y/size*n,ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
    const at=(dx:number,dy:number)=>values[((iy+dy)%n)*n+(ix+dx)%n];return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(0,0),at(1,0),sx),THREE.MathUtils.lerp(at(0,1),at(1,1),sx),sy);
  };
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const patch=noise(x,y,fields[0]),mottle=noise(x,y,fields[1]),fine=noise(x,y,fields[2]),grain=random(),i=(y*size+x)*4;
    const scratch=THREE.MathUtils.smoothstep(fine,.77,.88)*(1-THREE.MathUtils.smoothstep(Math.abs(Math.sin(x*.39+y*.015)),.025,.09));
    const wear=painted?scratch*.85:0,shade=(patch-.5)*17+(mottle-.5)*14+(grain-.5)*5;
    const paint=[87+shade,105+shade,93+shade],zinc=[158+shade,169+shade,163+shade];
    for(let c=0;c<3;c++)color[i+c]=painted?THREE.MathUtils.lerp(paint[c],zinc[c],wear):zinc[c];color[i+3]=255;
    surface[i]=128+(fine-.5)*28+(grain-.5)*9-wear*18;
    surface[i+1]=(painted?.62+patch*.12+mottle*.07-wear*.2:.43+patch*.18+mottle*.09)*255;
    surface[i+2]=(painted?.12+wear*.75:.91-patch*.13)*255;surface[i+3]=255;
  }
  const texture=(data:Uint8Array,name:string,srgb=false)=>{
    const map=new THREE.DataTexture(data,size,size);map.name=`${painted?'worn-green-coating':'oxidised-zinc'}-${name}`;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;
    map.generateMipmaps=true;map.minFilter=THREE.LinearMipmapLinearFilter;map.magFilter=THREE.LinearFilter;map.anisotropy=8;map.needsUpdate=true;return map;
  };
  const packed=texture(surface,'height-roughness-metalness');
  const material=new THREE.MeshStandardMaterial({map:texture(color,'color',true),bumpMap:packed,bumpScale:.00065,roughnessMap:packed,metalnessMap:packed,roughness:1,metalness:1,envMapIntensity:.85});
  material.name=painted?'weathered-green-fence-steel':'weathered-galvanised-post-steel';return material;
}

export function fenceMaterial(distance:number){
  const material=new THREE.MeshStandardMaterial({color:0x8d9991,metalness:.78,roughness:.66,envMapIntensity:.85,side:THREE.DoubleSide,alphaTest:.001,alphaToCoverage:true});
  material.name='rounded-weathered-zinc-fence-wire';
  const multisampled={value:1};let sampleRenderer:THREE.WebGLRenderer|undefined,canvasMultisampled=1;
  material.onBeforeRender=renderer=>{
    if(sampleRenderer!==renderer){canvasMultisampled=renderer.getContext().getContextAttributes()?.antialias?1:0;sampleRenderer=renderer;}
    // Water's opaque buffer is not multisampled. Re-evaluate per target;
    // canvas MSAA alone would turn cutout coverage into a solid panel there.
    const target=renderer.getRenderTarget();multisampled.value=target?(target.samples>0?1:0):canvasMultisampled;
  };
  material.onBeforeCompile=shader=>{
    shader.uniforms.fenceMultisampled=multisampled;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vFenceUv;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvFenceUv=uv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec2 vFenceUv;
      uniform float fenceMultisampled;
      float fenceHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float fenceNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(fenceHash(i),fenceHash(i+vec2(1,0)),f.x),mix(fenceHash(i+vec2(0,1)),fenceHash(i+vec2(1,1)),f.x),f.y);}
      // Integrate periodic strands to keep subpixel coverage stable.
      float fenceIntegral(float p,float h){
        float f=fract(p);return floor(p)*2.0*h+min(f,h)+max(0.0,f-(1.0-h));
      }
      float fenceStrand(float phase,float pixel){
        float w=max(pixel,.0001),unresolved=smoothstep(.3,1.2,w);
        float h=mix(max(.024,min(.065,w*.42)),.024,unresolved);
        float area=fenceIntegral(phase+w*.5,h)-fenceIntegral(phase-w*.5,h);
        return mix(clamp(area/w,0.0,1.0),.048,unresolved);
      }`)
      .replace('#include <map_fragment>',`#include <map_fragment>
        vec2 fenceMetres=vFenceUv*.16;
        float fenceOxide=fenceNoise(fenceMetres*vec2(2.1,5.7)+13.0);
        float fenceGrain=fenceNoise(fenceMetres*340.0);
        float fenceNear=1.0-smoothstep(.001,.004,max(fwidth(fenceMetres.x),fwidth(fenceMetres.y)));
        diffuseColor.rgb*=.82+fenceOxide*.24+(fenceGrain-.5)*.12*fenceNear;
      `)
      .replace('#include <alphatest_fragment>',`
        vec2 fencePhase=vec2(vFenceUv.x+vFenceUv.y,vFenceUv.x-vFenceUv.y);
        vec2 fencePixel=fwidth(fencePhase);
        float strandA=fenceStrand(fencePhase.x,fencePixel.x),strandB=fenceStrand(fencePhase.y,fencePixel.y);
        float coverage=1.0-(1.0-strandA)*(1.0-strandB);
        // Distant wires fade instead of leaving a grey veil over the panel.
        coverage*=1.0-smoothstep(.45,1.4,max(fencePixel.x,fencePixel.y));
        coverage*=1.0-smoothstep(${(distance*.75).toFixed(1)},${(distance*.9).toFixed(1)},length(vViewPosition));
        float noise=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
        if(fenceMultisampled<.5){
          if(coverage<=noise)discard;
          diffuseColor.a=1.0;
        }else{
          diffuseColor.a=coverage;
          if(coverage<.015)discard;
        }
      `)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(.5+fenceOxide*.24+(fenceGrain-.5)*.1*fenceNear,.48,.8);')
      .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor*=1.0-fenceOxide*.2;')
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        // Shade the cutout as round wire, with a separate cross-section for
        // each diagonal. Fade this relief before the strand is subpixel.
        vec2 fenceSigned=fract(fencePhase+.5)-.5;
        float fenceSelect=step(abs(fenceSigned.y),abs(fenceSigned.x));
        vec2 fenceGradient=mix(vec2(dFdx(fencePhase.x),dFdy(fencePhase.x)),vec2(dFdx(fencePhase.y),dFdy(fencePhase.y)),fenceSelect);
        float fenceCross=clamp(mix(fenceSigned.x,fenceSigned.y,fenceSelect)/.024,-.94,.94);
        vec3 fenceDx=dFdx(-vViewPosition),fenceDy=dFdy(-vViewPosition);
        vec3 fenceRx=cross(fenceDy,normal),fenceRy=cross(normal,fenceDx);
        float fenceDet=dot(fenceDx,fenceRx);
        vec3 fenceAcross=sign(fenceDet)*(fenceGradient.x*fenceRx+fenceGradient.y*fenceRy);
        fenceAcross/=max(length(fenceAcross),.000001);
        float fenceRound=1.0-smoothstep(.025,.16,max(fencePixel.x,fencePixel.y));
        vec3 fenceRoundNormal=normal*sqrt(1.0-fenceCross*fenceCross)+fenceAcross*fenceCross;
        normal=normalize(mix(normal,fenceRoundNormal,fenceRound));
      `);
  };
  // Keep the net in the depth-writing opaque pass, ahead of tyre smoke.
  material.customProgramCacheKey=()=>`rounded-zinc-catch-fence-v3-${distance}`;return material;
}
