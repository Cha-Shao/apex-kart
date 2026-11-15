import * as THREE from 'three';
import type {TrackData} from './track';
import {GUARDRAIL_POST_SPACING,GUARDRAIL_PROFILE,guardrailHeight,guardrailLayout,type GuardrailPoint} from './guardrail-layout';
import type {TerrainField} from './terrain';
import type {DetailLayer} from './track-environment';

function fenceTexture(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d')!;ctx.strokeStyle='#ffffff';ctx.lineWidth=2.5;
  // A repeating diamond cell, cut out in the opaque pass (no smoke sorting).
  for(const sign of [-1,1])for(let k=-1;k<=1;k++){ctx.beginPath();ctx.moveTo(k*128,sign<0?128:0);ctx.lineTo((k+1)*128,sign<0?0:128);ctx.stroke();}
  const map=new THREE.CanvasTexture(canvas);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;return map;
}
function steelTexture(){
  const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=128;const ctx=canvas.getContext('2d')!,w=canvas.width,h=canvas.height;
  ctx.fillStyle='#b9bdba';ctx.fillRect(0,0,w,h);let seed=391;
  for(let i=0;i<16000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const x=seed%w;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const z=seed%h;ctx.fillStyle=i%2?'rgba(255,255,250,.09)':'rgba(63,68,62,.07)';ctx.fillRect(x,z,2,1);}
  // A single repeating panel includes its seam, washer and shaded rivet head.
  // Matching metre-based UVs keep the fasteners aligned with the steel posts.
  const px=w/GUARDRAIL_POST_SPACING,py=h/GUARDRAIL_PROFILE.tierStep,cy=h*(1-.12/GUARDRAIL_PROFILE.tierStep);
  for(const x of [0,w]){
    ctx.fillStyle='rgba(49,57,53,.2)';ctx.fillRect(x-1,0,2,h);
    ctx.save();ctx.translate(x,cy);ctx.scale(px,py);
    const washer=ctx.createRadialGradient(-.006,.006,.003,0,0,.026);washer.addColorStop(0,'#d9dcd9');washer.addColorStop(.7,'#939c95');washer.addColorStop(1,'rgba(41,48,44,0)');
    ctx.fillStyle=washer;ctx.beginPath();ctx.arc(0,0,.026,0,Math.PI*2);ctx.fill();
    const head=ctx.createLinearGradient(-.014,-.014,.014,.014);head.addColorStop(0,'#f0f2eb');head.addColorStop(.45,'#c2c9c1');head.addColorStop(1,'#646f68');
    ctx.fillStyle=head;ctx.beginPath();ctx.arc(0,0,.0175,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  const map=new THREE.CanvasTexture(canvas);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;return map;
}

/** Render the same plan used by the physical barriers. */
export function addGuardrails(group:THREE.Group,track:TrackData,terrain:TerrainField,layers:DetailLayer[]){
  const layout=guardrailLayout(track),profile=GUARDRAIL_PROFILE;
  const metal=new THREE.MeshStandardMaterial({color:0xc2c6c3,map:steelTexture(),metalness:.72,roughness:.46,envMapIntensity:.8,side:THREE.DoubleSide,vertexColors:true});
  const postMaterial=new THREE.MeshStandardMaterial({color:0x818b86,metalness:.68,roughness:.58,envMapIntensity:.65});
  const green=new THREE.MeshStandardMaterial({color:0x36574b,metalness:.35,roughness:.75});
  const wire=new THREE.MeshStandardMaterial({color:0x55776a,map:fenceTexture(),metalness:.35,roughness:.8,side:THREE.DoubleSide,alphaTest:.42,alphaToCoverage:true});
  const steelPosts:THREE.Matrix4[]=[],fencePosts:THREE.Matrix4[]=[],dummy=new THREE.Object3D();
  const addInstance=(list:THREE.Matrix4[],p:GuardrailPoint,h:number,out:number,sx:number,sy:number,sz:number)=>{
    dummy.position.set(p.x+p.nx*out,guardrailHeight(p,terrain)+h,p.z+p.nz*out);dummy.rotation.set(0,Math.atan2(-p.nx,-p.nz),0);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();list.push(dummy.matrix.clone());
  };
  const register=(mesh:THREE.Mesh,distance:number)=>{mesh.receiveShadow=true;mesh.geometry.computeBoundingSphere();group.add(mesh);const sphere=mesh.geometry.boundingSphere;if(sphere)layers.push({object:mesh,center:sphere.center.clone(),distance});};
  const railDistance=track.length>3500?1500:1050;
  const emit=(points:GuardrailPoint[])=>{
    if(points.length<2)return;
    const positions:number[]=[],colors:number[]=[],uvs:number[]=[],indices:number[]=[],fencePositions:number[]=[],fenceUVs:number[]=[],fenceIndices:number[]=[];
    // Three continuous W-section sheets. Corrugation gives real highlights
    // and self shading without individual brick-like rail modules.
    const wave=[profile.back,.015,profile.front,.015,profile.back,.015,profile.front,.015,profile.back];
    for(const [i,p] of points.entries()){
      const y=guardrailHeight(p,terrain);
      for(let tier=0;tier<profile.tiers;tier++)for(let j=0;j<wave.length;j++){
        const localHeight=j/(wave.length-1)*profile.tierHeight,h=profile.base+tier*profile.tierStep+localHeight,out=wave[j],light=.9+.055*Math.sin(p.d*.31)+.025*Math.sin(p.d*1.7+tier);
        positions.push(p.x+p.nx*out,y+h,p.z+p.nz*out);colors.push(light,light,light*.985);uvs.push(p.d/GUARDRAIL_POST_SPACING,localHeight/profile.tierStep);
        if(i&&j<wave.length-1){const a=(i*profile.tiers+tier)*wave.length+j,b=a-profile.tiers*wave.length;indices.push(b,a,b+1,a,a+1,b+1);}
      }
      for(const h of [profile.fenceBottom,profile.fenceTop]){fencePositions.push(p.x+p.nx*profile.fenceOffset,y+h,p.z+p.nz*profile.fenceOffset);fenceUVs.push(p.d/.16,h/.16);}
      if(i){const a=i*2;fenceIndices.push(a-2,a,a-1,a,a+1,a-1);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,metal);mesh.name='terrain-following triple Armco';mesh.castShadow=true;register(mesh,railDistance);
    const fence=new THREE.BufferGeometry();fence.setAttribute('position',new THREE.Float32BufferAttribute(fencePositions,3));fence.setAttribute('uv',new THREE.Float32BufferAttribute(fenceUVs,2));fence.setIndex(fenceIndices);fence.computeVertexNormals();
    const net=new THREE.Mesh(fence,wire);net.name='green diamond catch fence';register(net,650);
  };
  layout.paths.forEach(emit);
  for(const p of layout.posts){addInstance(steelPosts,p,.52,.14,.09,1.08,.12);addInstance(fencePosts,p,1.12,profile.fenceOffset,.055,2.36,.055);}
  const batch=(geometry:THREE.BufferGeometry,material:THREE.Material,matrices:THREE.Matrix4[],name:string,distance:number)=>{
    // Spatial batches preserve frustum/distance culling on full-size circuits.
    const cells=new Map<string,THREE.Matrix4[]>();
    for(const matrix of matrices){const e=matrix.elements,k=`${Math.floor(e[12]/90)},${Math.floor(e[14]/90)}`,list=cells.get(k)??[];list.push(matrix);cells.set(k,list);}
    for(const list of cells.values()){
      const mesh=new THREE.InstancedMesh(geometry,material,list.length);mesh.name=name;list.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.castShadow=name==='Armco steel posts';mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);if(mesh.boundingSphere)layers.push({object:mesh,center:mesh.boundingSphere.center.clone(),distance});
    }
    if(!cells.size)geometry.dispose();
  };
  batch(new THREE.BoxGeometry(1,1,1),postMaterial,steelPosts,'Armco steel posts',railDistance);
  batch(new THREE.BoxGeometry(1,1,1),green,fencePosts,'green catch fence uprights',650);
}
