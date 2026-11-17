import * as THREE from 'three';
import type {TrackData} from './track';
import {GUARDRAIL_POST_SPACING,GUARDRAIL_PROFILE,guardrailHeight,guardrailLayout,type GuardrailPoint} from './guardrail-layout';
import type {TerrainField} from './terrain';
import type {DetailLayer} from './track-environment';
import {addGroundContactShadows} from './contact-shadow';

function fenceMaterial(distance:number){
  const material=new THREE.MeshStandardMaterial({color:0x394d43,metalness:.18,roughness:.92,envMapIntensity:.2,side:THREE.DoubleSide,alphaTest:.001,alphaToCoverage:true});
  const multisampled={value:1};let sampleRenderer:THREE.WebGLRenderer|undefined,canvasMultisampled=1;
  material.onBeforeRender=renderer=>{
    if(sampleRenderer!==renderer){canvasMultisampled=renderer.getContext().getContextAttributes()?.antialias?1:0;sampleRenderer=renderer;}
    // Water's opaque buffer is not multisampled. Re-evaluate per target; using
    // the canvas MSAA state there turns cutout coverage into a solid panel.
    const target=renderer.getRenderTarget();multisampled.value=target?(target.samples>0?1:0):canvasMultisampled;
  };
  material.onBeforeCompile=shader=>{
    shader.uniforms.fenceMultisampled=multisampled;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vFenceUv;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvFenceUv=uv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec2 vFenceUv;
      uniform float fenceMultisampled;
      // Integral of a periodic strand: large pixel footprints converge to
      // average coverage instead of losing every wire to a fixed alpha test.
      float fenceIntegral(float p,float h){
        float f=fract(p);return floor(p)*2.0*h+min(f,h)+max(0.0,f-(1.0-h));
      }
      float fenceStrand(float phase,float pixel){
        float w=max(pixel,.0001),unresolved=smoothstep(.3,1.2,w);
        float h=mix(max(.024,min(.065,w*.42)),.024,unresolved);
        float area=fenceIntegral(phase+w*.5,h)-fenceIntegral(phase-w*.5,h);
        return mix(clamp(area/w,0.0,1.0),.048,unresolved);
      }`)
      .replace('#include <alphatest_fragment>',`
        vec2 fencePhase=vec2(vFenceUv.x+vFenceUv.y,vFenceUv.x-vFenceUv.y);
        vec2 fencePixel=fwidth(fencePhase);
        float strandA=fenceStrand(fencePhase.x,fencePixel.x),strandB=fenceStrand(fencePhase.y,fencePixel.y);
        float coverage=1.0-(1.0-strandA)*(1.0-strandB);
        // Fade wires once they are smaller than a pixel, instead of retaining
        // a constant grey/white veil over the entire distant fence panel.
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
      .replace('#include <lights_physical_fragment>','#include <lights_physical_fragment>\nmaterial.specularColor*=.25;material.specularF90*=.3;');
  };
  // Keep the net in the depth-writing opaque pass, ahead of tyre smoke.
  material.customProgramCacheKey=()=>`analytic-catch-fence-v2-${distance}`;return material;
}
function steelTextures(){
  const w=2048,h=128,canvas=()=>{const image=document.createElement('canvas');image.width=w;image.height=h;return image;};
  const color=canvas(),roughness=canvas(),metalness=canvas(),bump=canvas(),ctx=color.getContext('2d')!,rough=roughness.getContext('2d')!,metal=metalness.getContext('2d')!,height=bump.getContext('2d')!;
  const images=[ctx,rough,metal,height].map(c=>c.createImageData(w,h));let seed=391;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const fields=[[32,4],[128,12],[256,32]].map(([nx,ny])=>({nx,ny,values:Float32Array.from({length:nx*ny},random)}));
  const noise=(x:number,y:number,field:typeof fields[number])=>{
    const {nx,ny,values}=field,px=x/w*nx,py=y/h*ny,ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy),a=values[iy*nx+ix],b=values[iy*nx+(ix+1)%nx],c=values[((iy+1)%ny)*nx+ix],d=values[((iy+1)%ny)*nx+(ix+1)%nx];return (a+(b-a)*sx)*(1-sy)+(c+(d-c)*sx)*sy;
  };
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const macro=noise(x,y,fields[0]),mottle=noise(x,y,fields[1]),grain=random(),lowerEdge=Math.max(0,(y/h-.68)/.32),oxide=Math.max(0,macro-.38)*.3+lowerEdge*.12,shade=(mottle-.5)*6+(grain-.5)*3-oxide*20,i=(y*w+x)*4;
    const values=[[171+shade,179+shade-oxide*4,176+shade-oxide*8],[(.44+oxide*.2+mottle*.06+grain*.02)*255],[(.97-oxide*.22)*255],[128+(noise(x,y,fields[2])-.5)*8+(grain-.5)*3]];
    images.forEach((image,k)=>{const data=values[k];image.data[i]=data[0];image.data[i+1]=data[1]??data[0];image.data[i+2]=data[2]??data[0];image.data[i+3]=255;});
  }
  [ctx,rough,metal,height].forEach((c,i)=>c.putImageData(images[i],0,0));
  // Broken horizontal scuffs expose less-oxidised zinc among matte patches.
  for(let i=0;i<95;i++){
    const x=random()*w,y=random()*h,length=8+random()*150;
    ctx.fillStyle='rgba(217,224,219,.07)';ctx.fillRect(x,y,length,.5+random());rough.fillStyle='#737373';rough.fillRect(x,y,length,1);height.fillStyle='#858585';height.fillRect(x,y,length,1);
  }
  // A single repeating panel includes its seam, washer and shaded rivet head.
  // Matching metre-based UVs keep the fasteners aligned with the steel posts.
  const px=w/GUARDRAIL_POST_SPACING,py=h/GUARDRAIL_PROFILE.tierStep,cy=h*(1-.12/GUARDRAIL_PROFILE.tierStep);
  for(const x of [0,w]){
    ctx.fillStyle='rgba(49,57,53,.2)';ctx.fillRect(x-1,0,2,h);
    rough.fillStyle='#cacaca';rough.fillRect(x-4,0,8,h);metal.fillStyle='#b0b0b0';metal.fillRect(x-2,0,4,h);
    const drip=ctx.createLinearGradient(0,cy,0,h);drip.addColorStop(0,'rgba(87,67,43,.3)');drip.addColorStop(1,'rgba(87,67,43,0)');ctx.fillStyle=drip;ctx.fillRect(x-5,cy,10,h-cy);
    ctx.save();ctx.translate(x,cy);ctx.scale(px,py);
    const washer=ctx.createRadialGradient(-.006,.006,.003,0,0,.026);washer.addColorStop(0,'#d9dcd9');washer.addColorStop(.7,'#939c95');washer.addColorStop(1,'rgba(41,48,44,0)');
    ctx.fillStyle=washer;ctx.beginPath();ctx.arc(0,0,.026,0,Math.PI*2);ctx.fill();
    const head=ctx.createLinearGradient(-.014,-.014,.014,.014);head.addColorStop(0,'#f0f2eb');head.addColorStop(.45,'#c2c9c1');head.addColorStop(1,'#646f68');
    ctx.fillStyle=head;ctx.beginPath();ctx.arc(0,0,.0175,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  const texture=(image:HTMLCanvasElement,name:string,srgb=false)=>{const map=new THREE.CanvasTexture(image);map.name=`weathered-galvanised-${name}`;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;map.anisotropy=8;return map;};
  return {map:texture(color,'color',true),roughnessMap:texture(roughness,'roughness'),metalnessMap:texture(metalness,'metalness'),bumpMap:texture(bump,'micro-relief')};
}

/** Render the same plan used by the physical barriers. */
export function addGuardrails(group:THREE.Group,track:TrackData,terrain:TerrainField,layers:DetailLayer[]){
  const layout=guardrailLayout(track),profile=GUARDRAIL_PROFILE,railDistance=track.length>3500?1500:1050;
  const metal=new THREE.MeshStandardMaterial({color:0xf2f4f1,...steelTextures(),metalness:.96,roughness:1,bumpScale:.00025,envMapIntensity:1.05,side:THREE.DoubleSide,vertexColors:true});
  metal.name='weathered-galvanised-Armco';
  metal.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vSteelWeatherUv;').replace('#include <begin_vertex>',`#include <begin_vertex>\nvSteelWeatherUv=vec2(uv.x*${GUARDRAIL_POST_SPACING.toFixed(4)},position.y);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec2 vSteelWeatherUv;
      float steelHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float steelNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(steelHash(i),steelHash(i+vec2(1,0)),f.x),mix(steelHash(i+vec2(0,1)),steelHash(i+vec2(1,1)),f.x),f.y);}
    `)
      .replace('#include <map_fragment>',`#include <map_fragment>
        // Metre-based weathering never wraps at a post or repeats per tier.
        float steelOxide=steelNoise(vSteelWeatherUv*vec2(.31,2.7)+11.0)*.7+steelNoise(vSteelWeatherUv*vec2(1.17,5.3)+37.0)*.3;
        diffuseColor.rgb*=.91+.13*steelOxide;
      `)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(.34+steelOxide*.3+(roughnessFactor-.5)*.35,.34,.8);')
      .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor*=1.0-steelOxide*.18;');
  };
  metal.customProgramCacheKey=()=>'rounded-weathered-Armco-v2';
  const postMaterial=new THREE.MeshStandardMaterial({color:0x929c97,metalness:.88,roughness:.6,envMapIntensity:.85});
  const green=new THREE.MeshStandardMaterial({color:0x354a3d,metalness:.18,roughness:.9,envMapIntensity:.3});
  const wire=fenceMaterial(railDistance);
  const steelPosts:THREE.Matrix4[]=[],fencePosts:THREE.Matrix4[]=[],dummy=new THREE.Object3D();
  const addInstance=(list:THREE.Matrix4[],p:GuardrailPoint,h:number,out:number,sx:number,sy:number,sz:number)=>{
    dummy.position.set(p.x+p.nx*out,guardrailHeight(p,terrain)+h,p.z+p.nz*out);dummy.rotation.set(0,Math.atan2(-p.nx,-p.nz),0);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();list.push(dummy.matrix.clone());
  };
  const register=(mesh:THREE.Mesh,distance:number)=>{mesh.receiveShadow=true;mesh.geometry.computeBoundingSphere();group.add(mesh);const sphere=mesh.geometry.boundingSphere;if(sphere)layers.push({object:mesh,center:sphere.center.clone(),distance:distance+sphere.radius});};
  const emit=(points:GuardrailPoint[])=>{
    if(points.length<2)return;
    const positions:number[]=[],colors:number[]=[],uvs:number[]=[],indices:number[]=[],fencePositions:number[]=[],fenceUVs:number[]=[],fenceIndices:number[]=[];
    // Three continuous W-section sheets. Corrugation gives real highlights
    // and self shading without individual brick-like rail modules.
    // Smooth rolled W-section: the old nine-point zigzag made every crest
    // and trough a sharp projecting edge when seen from the end.
    const wave=Array.from({length:25},(_,j)=>({height:j/24*profile.tierHeight,out:(profile.back+profile.front)*.5+(profile.back-profile.front)*.5*Math.cos(j/24*Math.PI*4)}));
    for(const [i,p] of points.entries()){
      const y=guardrailHeight(p,terrain);
      for(let tier=0;tier<profile.tiers;tier++)for(let j=0;j<wave.length;j++){
        const localHeight=wave[j].height,h=profile.base+tier*profile.tierStep+localHeight,out=wave[j].out,light=.94+.025*Math.sin(p.d*.13+tier*.91)+.015*Math.sin(p.d*.43+tier*1.73);
        positions.push(p.x+p.nx*out,y+h,p.z+p.nz*out);colors.push(light,light,light*.985);uvs.push(p.d/GUARDRAIL_POST_SPACING,localHeight/profile.tierStep);
        if(i&&j<wave.length-1){const a=(i*profile.tiers+tier)*wave.length+j,b=a-profile.tiers*wave.length;indices.push(b,a,b+1,a,a+1,b+1);}
      }
      for(const h of [profile.fenceBottom,profile.fenceTop]){fencePositions.push(p.x+p.nx*profile.fenceOffset,y+h,p.z+p.nz*profile.fenceOffset);fenceUVs.push(p.d/.16,h/.16);}
      if(i){const a=i*2;fenceIndices.push(a-2,a,a-1,a,a+1,a-1);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,metal);mesh.name='terrain-following triple Armco';mesh.castShadow=true;register(mesh,railDistance);
    const fence=new THREE.BufferGeometry();fence.setAttribute('position',new THREE.Float32BufferAttribute(fencePositions,3));fence.setAttribute('uv',new THREE.Float32BufferAttribute(fenceUVs,2));fence.setIndex(fenceIndices);fence.computeVertexNormals();
    const net=new THREE.Mesh(fence,wire);net.name='green diamond catch fence';register(net,railDistance);
  };
  layout.paths.forEach(emit);
  for(const p of layout.posts){addInstance(steelPosts,p,.52,.14,.09,1.08,.12);addInstance(fencePosts,p,1.12,profile.fenceOffset,.055,2.36,.055);}
  const batch=(geometry:THREE.BufferGeometry,material:THREE.Material,matrices:THREE.Matrix4[],name:string,distance:number)=>{
    // Spatial batches preserve frustum/distance culling on full-size circuits.
    const cells=new Map<string,THREE.Matrix4[]>();
    for(const matrix of matrices){const e=matrix.elements,k=`${Math.floor(e[12]/90)},${Math.floor(e[14]/90)}`,list=cells.get(k)??[];list.push(matrix);cells.set(k,list);}
    for(const list of cells.values()){
      const mesh=new THREE.InstancedMesh(geometry,material,list.length);mesh.name=name;list.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.castShadow=name==='Armco steel posts';mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);if(mesh.boundingSphere)layers.push({object:mesh,center:mesh.boundingSphere.center.clone(),distance:distance+mesh.boundingSphere.radius});
    }
    if(!cells.size)geometry.dispose();
  };
  batch(new THREE.BoxGeometry(1,1,1),postMaterial,steelPosts,'Armco steel posts',railDistance);
  batch(new THREE.BoxGeometry(1,1,1),green,fencePosts,'green catch fence uprights',railDistance);
  layers.push(...addGroundContactShadows(group,terrain,layout.posts.filter(p=>Math.abs(p.deck)<.12).map(p=>({x:p.x+p.nx*.19,z:p.z+p.nz*.19,radiusX:.24,radiusZ:.32,strength:.32,angle:Math.atan2(-p.nx,-p.nz)})),'barrier-footing-contact-occlusion'));
}
