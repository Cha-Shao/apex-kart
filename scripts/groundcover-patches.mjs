import path from 'node:path';
import sharp from 'sharp';

const ATLAS_CELL=256,ATLAS_PADDING=12;
const seeded=initial=>{let seed=initial;return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};};
const accessor=(document,buffer,type,array)=>document.createAccessor().setType(type).setArray(array).setBuffer(buffer);

/** Dense elliptical growth with a soft, broken perimeter. Best-candidate
 * samples keep the roots separate; the radial bias fills the centre first. */
function clumpRoot(random,points,cx,cz,rx,rz,phase){
  let best,score=-1;
  for(let attempt=0;attempt<12;attempt++){
    const angle=random()*Math.PI*2,radius=random()**.72,edge=.9+.1*Math.sin(angle*3+phase);
    const point={x:cx+Math.cos(angle)*radius*rx*edge,z:cz+Math.sin(angle)*radius*rz*edge,vigor:1-.23*radius};
    let distance=Infinity;
    for(const other of points)distance=Math.min(distance,(point.x-other.x)**2+(point.z-other.z)**2);
    if(distance>score){best=point;score=distance;}
  }
  points.push(best);return best;
}

/** One continuous card, split at mid-height. Even the lower face leans away
 * from the root; the upper face bends further in the same direction. */
function bentCard(data,{x=0,z=0,width,height,rotation,atlas,mirror,tint,lower,upper}){
  const {positions,uvs,indices,roots,heights,normals,colors}=data,base=positions.length/3,c=Math.cos(rotation),s=Math.sin(rotation);
  const u0=(atlas*ATLAS_CELL+ATLAS_PADDING)/1024,u1=((atlas+1)*ATLAS_CELL-ATLAS_PADDING)/1024,v0=12/512,v1=500/512;
  const mid=.52,lowerLean=Math.tan(lower)*height*mid;
  for(let row=0;row<3;row++)for(const side of [-1,1]){
    const t=row===0?0:row===1?mid:1,lean=row===0?0:row===1?lowerLean:lowerLean+Math.tan(upper)*height*(1-mid);
    positions.push(x+c*side*width*.5-s*lean,height*t,z+s*side*width*.5+c*lean);
    roots.push(x,z);heights.push(t);normals.push(0,1,0);colors.push(tint*.99,tint,tint*.96);
    uvs.push((side<0)!==mirror?u0:u1,v1-(v1-v0)*t);
  }
  for(let row=0;row<2;row++){const a=base+row*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
}

function grassPrimitive(document,buffer,material,data){
  return document.createPrimitive().setMaterial(material)
    .setAttribute('POSITION',accessor(document,buffer,'VEC3',new Float32Array(data.positions)))
    .setAttribute('NORMAL',accessor(document,buffer,'VEC3',new Float32Array(data.normals)))
    .setAttribute('TEXCOORD_0',accessor(document,buffer,'VEC2',new Float32Array(data.uvs)))
    .setAttribute('COLOR_0',accessor(document,buffer,'VEC3',new Float32Array(data.colors)))
    .setAttribute('_PLANT_ROOT',accessor(document,buffer,'VEC2',new Float32Array(data.roots)))
    .setAttribute('_PLANT_HEIGHT',accessor(document,buffer,'SCALAR',new Float32Array(data.heights)))
    .setIndices(accessor(document,buffer,'SCALAR',new Uint16Array(data.indices)));
}
const cardData=()=>({positions:[],uvs:[],indices:[],roots:[],heights:[],normals:[],colors:[]});

// Pack alpha explicitly: removeAlpha() is a deferred Sharp operation and can
// otherwise strip a channel that joinChannel() just appended in the pipeline.
export function rgbaPixels(rgb,alpha){
  if(rgb.length!==alpha.length*3)throw Error('RGB/alpha pixel dimensions differ');
  const pixels=Buffer.alloc(alpha.length*4);
  for(let i=0;i<alpha.length;i++){pixels[i*4]=rgb[i*3];pixels[i*4+1]=rgb[i*3+1];pixels[i*4+2]=rgb[i*3+2];pixels[i*4+3]=alpha[i];}
  return pixels;
}

// Keep only the rooted tuft, excluding loose neighbouring blades in the atlas.
function isolateCluster(mask,width,height){
  const seen=new Uint8Array(mask.length),queue=new Int32Array(mask.length);let largest=new Int32Array(0);
  for(let seed=0;seed<mask.length;seed++){
    if(seen[seed]||mask[seed]<=16)continue;
    let head=0,tail=1;queue[0]=seed;seen[seed]=1;
    while(head<tail){
      const index=queue[head++],x=index%width,y=Math.floor(index/width);
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
        const px=x+dx,py=y+dz;if(px<0||px>=width||py<0||py>=height)continue;
        const next=py*width+px;if(seen[next]||mask[next]<=16)continue;
        seen[next]=1;queue[tail++]=next;
      }
    }
    if(tail>largest.length)largest=queue.slice(0,tail);
  }
  if(!largest.length)throw Error('Grass-cluster crop contains no opaque leaves');
  const isolated=Buffer.alloc(mask.length);let minX=width,minY=height,maxX=0,maxY=0;
  for(const index of largest){const x=index%width,y=Math.floor(index/width);isolated[index]=mask[index];minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  return {isolated,crop:{left:minX,top:minY,width:maxX-minX+1,height:maxY-minY+1}};
}

/** Reuse small rooted photographic tufts as narrow blade bundles. Physical
 * card width is authored separately from height and the source crop's aspect. */
export async function groundcoverPatches({document,buffer,scene,metadata,cache,cached}){
  const id='grass_medium_01',colorFile=metadata.Diffuse['4k'].jpg,alphaFile=metadata.Alpha['4k'].png;
  const color=await cached(path.join(cache,id,'patch-diff-4k.jpg'),colorFile),alpha=await cached(path.join(cache,id,'patch-alpha-4k.png'),alphaFile);
  const colorInfo=await sharp(color).metadata(),factor=colorInfo.width/1024;
  // Small fan-shaped tufts have converging roots instead of the long, flat
  // baseline of the former whole-meadow crops. Each is only a few cm wide
  // in the game, with many fine leaf silhouettes and transparent gaps.
  // Stop at the leaf fan's root line. The atlas continues below these fans
  // with straight opaque UV padding for the source model's stem geometry.
  // That padding is not part of the billboard silhouette.
  const regions=[{left:20,top:884,width:190,height:112},{left:252,top:906,width:264,height:94},{left:610,top:905,width:210,height:102},{left:576,top:760,width:288,height:120}],colors=[];
  for(const [i,region] of regions.entries()){
    const box=Object.fromEntries(Object.entries(region).map(([key,value])=>[key,Math.round(value*factor)]));
    const mask=await sharp(alpha).extract(box).removeAlpha().greyscale().raw().toBuffer();
    const cluster=isolateCluster(mask,box.width,box.height),crop={...cluster.crop,left:box.left+cluster.crop.left,top:box.top+cluster.crop.top},width=ATLAS_CELL-ATLAS_PADDING*2;
    const cutout=await sharp(cluster.isolated,{raw:{width:box.width,height:box.height,channels:1}}).extract(cluster.crop).resize(width,488).toColourspace('b-w').raw().toBuffer();
    const rgb=await sharp(color).extract(crop).resize(width,488).removeAlpha().raw().toBuffer();
    colors.push({input:await sharp(rgbaPixels(rgb,cutout),{raw:{width,height:488,channels:4}}).png().toBuffer(),left:i*ATLAS_CELL+ATLAS_PADDING,top:12});
  }
  const rgba=await sharp({create:{width:1024,height:512,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(colors).webp({quality:91,alphaQuality:100}).toBuffer();
  const material=document.createMaterial('meadow-patches-groundcover').setBaseColorTexture(document.createTexture('meadow-clusters-rgba').setImage(rgba).setMimeType('image/webp'))
    .setMetallicFactor(0).setRoughnessFactor(1).setAlphaMode('MASK').setAlphaCutoff(.4).setDoubleSided(true);
  const grassVariants=[];
  for(const [kind,height,atlas] of [['grass-short-a',.13,0],['grass-short-b',.145,1],['grass-tall-a',.2,2],['grass-tall-b',.215,3]]){
    const tall=kind.startsWith('grass-tall'),count=tall?48:40,random=seeded(3149+atlas*193),roots=[];
    const layout=Array.from({length:count},()=>clumpRoot(random,roots,0,0,tall?.18:.14,tall?.16:.12,atlas));
    for(let level=0;level<2;level++){
      const data=cardData(),cards=level===0?count:count/2;
      for(let i=0;i<cards;i++){
        const variation=seeded(8317+atlas*2971+i*197),root=layout[i];
        bentCard(data,{...root,width:.045+variation()*.02,height:height*(.94+variation()*.12)*root.vigor,rotation:variation()*Math.PI*2,atlas,mirror:variation()<.5,tint:.94+variation()*.06,lower:.14+variation()*.08,upper:.34+variation()*.12});
      }
      const name=`${kind}-${level===0?'near':'far'}`;
      scene.addChild(document.createNode(name).setMesh(document.createMesh(name).addPrimitive(grassPrimitive(document,buffer,material,data))));
      grassVariants.push({name,height,cards,cardWidth:[.045,.065],triangles:data.indices.length/3,shape:'dense small elliptical tuft; each narrow card has two progressively leaning faces'});
    }
  }
  return {source:id,sourceFiles:[colorFile,alphaFile].map(({url,md5})=>({url,md5})),atlas:'Four small rooted photographic tufts from the original 4K atlas, packed into shared 1024x512 RGBA. Straight opaque stem padding is trimmed off. Card width 4.5-6.5cm, independent of height. Each card has two connected tilted faces and upward lighting normals; no grass normal or AO map.',grassVariants,colonies:'Runtime groups of 2-3 touching high tufts and 3-5 partial low-grass companions. Each actual tuft fits the land independently; interiors are not randomly thinned. Near/far LODs share surviving card anchors, dimensions and bends.'};
}
