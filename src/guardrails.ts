import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import type {TrackData} from './track';
import {GUARDRAIL_POST_SPACING,GUARDRAIL_PROFILE,guardrailHeight,guardrailLayout,type GuardrailPoint} from './guardrail-layout';
import type {TerrainField} from './terrain';
import type {DetailLayer} from './track-environment';
import {addGroundContactShadows} from './contact-shadow';
import {FENCE_METAL_TILE,fenceMaterial,guardrailPostMaterial} from './guardrail-materials';

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

/** Small rolled edges catch sunlight without adding separate post models. */
function postGeometry(width:number,height:number,depth:number){
  const geometry=new RoundedBoxGeometry(width,height,depth,1,Math.min(width,depth)*.065),uv=geometry.getAttribute('uv');
  for(const group of geometry.groups){
    const face=group.materialIndex??0,u=face<2?depth:width,v=face===2||face===3?depth:height;
    for(let i=group.start;i<group.start+group.count;i++)uv.setXY(i,uv.getX(i)*u/FENCE_METAL_TILE,uv.getY(i)*v/FENCE_METAL_TILE);
  }
  return geometry;
}

/** Sweep two continuous binding tubes through the same vertices as the net.
 * Ring positions agree at chunk joins; openings retain their own capped ends. */
function fenceBindingGeometry(points:GuardrailPoint[],terrain:TerrainField){
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[],sides=8,ring=sides+1;
  const heights=points.map(p=>guardrailHeight(p,terrain)),profile=GUARDRAIL_PROFILE;
  for(const [height,radius] of [[profile.fenceBottom,.014],[profile.fenceTop,.02]]){
    const base=positions.length/3;
    for(const [i,p] of points.entries()){
      for(let j=0;j<=sides;j++){
        const angle=j/sides*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle);
        positions.push(p.x+p.nx*(profile.fenceOffset+c*radius),heights[i]+height+s*radius,p.z+p.nz*(profile.fenceOffset+c*radius));
        normals.push(p.nx*c,s,p.nz*c);uvs.push(p.d/FENCE_METAL_TILE,angle*radius/FENCE_METAL_TILE);
        if(i&&j<sides){const a=base+(i-1)*ring+j,b=base+i*ring+j;indices.push(a,a+1,b,a+1,b+1,b);}
      }
    }
    for(const end of [0,points.length-1]){
      const p=points[end],sign=end===0?-1:1,center=positions.length/3,source=base+end*ring;
      const next=end===0?1:end-1,dy=(heights[next]-heights[end])/(Math.hypot(points[next].x-p.x,points[next].z-p.z)||1)*(end===0?1:-1);
      const axis=new THREE.Vector3(-p.nz,dy,p.nx).normalize().multiplyScalar(sign);
      positions.push(p.x+p.nx*profile.fenceOffset,heights[end]+height,p.z+p.nz*profile.fenceOffset);normals.push(axis.x,axis.y,axis.z);uvs.push(.5,.5);
      for(let j=0;j<=sides;j++){
        positions.push(positions[(source+j)*3],positions[(source+j)*3+1],positions[(source+j)*3+2]);normals.push(axis.x,axis.y,axis.z);
        const angle=j/sides*Math.PI*2;uvs.push((.5+Math.cos(angle)*.5)*radius*2/FENCE_METAL_TILE,(.5+Math.sin(angle)*.5)*radius*2/FENCE_METAL_TILE);
        if(j<sides){const a=center+1+j,b=a+1;indices.push(center,...(end===0?[b,a]:[a,b]));}
      }
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);return geometry;
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
  const postMaterial=guardrailPostMaterial(false),green=guardrailPostMaterial(true);
  const wire=fenceMaterial(railDistance);
  const steelPosts:THREE.Matrix4[]=[],fencePosts:THREE.Matrix4[]=[],dummy=new THREE.Object3D();
  const addInstance=(list:THREE.Matrix4[],p:GuardrailPoint,h:number,out:number)=>{
    dummy.position.set(p.x+p.nx*out,guardrailHeight(p,terrain)+h,p.z+p.nz*out);dummy.rotation.set(0,Math.atan2(-p.nx,-p.nz),0);dummy.updateMatrix();list.push(dummy.matrix.clone());
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
    const net=new THREE.Mesh(fence,wire);net.name='galvanised diamond catch fence';register(net,railDistance);
    const binding=new THREE.Mesh(fenceBindingGeometry(points,terrain),green);binding.name='continuous upper and lower catch fence binding';register(binding,railDistance);
  };
  layout.paths.forEach(emit);
  const uprightHeight=profile.fenceTop+.1;
  for(const p of layout.posts){addInstance(steelPosts,p,.52,.14);addInstance(fencePosts,p,uprightHeight*.5-.06,profile.fenceOffset);}
  const batch=(geometry:THREE.BufferGeometry,material:THREE.Material,matrices:THREE.Matrix4[],name:string,distance:number)=>{
    // Spatial batches preserve frustum/distance culling on full-size circuits.
    const cells=new Map<string,THREE.Matrix4[]>();
    for(const matrix of matrices){const e=matrix.elements,k=`${Math.floor(e[12]/90)},${Math.floor(e[14]/90)}`,list=cells.get(k)??[];list.push(matrix);cells.set(k,list);}
    for(const list of cells.values()){
      const mesh=new THREE.InstancedMesh(geometry,material,list.length);mesh.name=name;list.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.castShadow=name==='Armco steel posts';mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);if(mesh.boundingSphere)layers.push({object:mesh,center:mesh.boundingSphere.center.clone(),distance:distance+mesh.boundingSphere.radius});
    }
    if(!cells.size)geometry.dispose();
  };
  batch(postGeometry(.09,1.08,.12),postMaterial,steelPosts,'Armco steel posts',railDistance);
  batch(postGeometry(.055,uprightHeight,.055),green,fencePosts,'green catch fence uprights',railDistance);
  layers.push(...addGroundContactShadows(group,terrain,layout.posts.filter(p=>Math.abs(p.deck)<.12).map(p=>({x:p.x+p.nx*.19,z:p.z+p.nz*.19,radiusX:.24,radiusZ:.32,strength:.32,angle:Math.atan2(-p.nx,-p.nz)})),'barrier-footing-contact-occlusion'));
}
