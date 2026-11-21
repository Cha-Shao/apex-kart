import * as THREE from 'three';

export const GRASS_BLADE_KINDS=['grass-short-a','grass-short-b','grass-tall-a','grass-tall-b'] as const;
export type GrassBladeKind=typeof GRASS_BLADE_KINDS[number];

// Double grass tuft size without changing spawn density or other vegetation.
const GRASS_VISUAL_SCALE=2;

interface TuftShape {
  height:number;width:number;lowerLean:number;upperLean:number;
  // Original grass_N files are used DIRECTLY. The UV window trims only the
  // empty transparency; the source files are never repacked or overwritten.
  textureWidth:number;uLeft:number;uRight:number;topY:number;
}
const TUFTS:Record<GrassBladeKind,TuftShape>={
  'grass-short-a':{height:.24,width:.165,lowerLean:.014,upperLean:.038,textureWidth:512,uLeft:107,uRight:385,topY:308},
  'grass-short-b':{height:.27,width:.190,lowerLean:-.016,upperLean:-.042,textureWidth:512,uLeft:78,uRight:436,topY:286},
  'grass-tall-a':{height:.31,width:.225,lowerLean:.019,upperLean:.050,textureWidth:559,uLeft:104,uRight:484,topY:301},
  'grass-tall-b':{height:.35,width:.255,lowerLean:-.022,upperLean:-.054,textureWidth:512,uLeft:70,uRight:254,topY:286},
};
const maps=new Map<GrassBladeKind,THREE.Texture>();
function grassTuftMap(kind:GrassBladeKind){
  const existing=maps.get(kind);if(existing)return existing;
  const index=GRASS_BLADE_KINDS.indexOf(kind);
  const texture=new THREE.TextureLoader().load(`/assets/vegetation/grass_${index}.png`);
  texture.name=`grass-${index}-source-alpha`;
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.magFilter=THREE.LinearFilter;
  texture.anisotropy=4;
  maps.set(kind,texture);
  return texture;
}

/** One connected card, two joined tilted quadrilaterals, preserving the
 * source grass_0..3 artwork and all its luminance detail. */
function tuftGeometry(shape:TuftShape){
  const positions:number[]=[],uvs:number[]=[],roots:number[]=[],heights:number[]=[];
  const uLeft=shape.uLeft/shape.textureWidth,uRight=shape.uRight/shape.textureWidth;
  // THREE.TextureLoader flips loaded images on Y. Bottom of source PNG is v=0.
  const vTop=(512-shape.topY)/512;
  for(let row=0;row<3;row++){
    const t=row/2,offset=row===0?0:row===1?shape.lowerLean:shape.lowerLean+shape.upperLean;
    for(const side of [-1,1]){
      positions.push((side*shape.width*.5+offset)*GRASS_VISUAL_SCALE,shape.height*t*GRASS_VISUAL_SCALE,row*.005*GRASS_VISUAL_SCALE);
      uvs.push(side<0?uLeft:uRight,vTop*t);
      roots.push(0,0);heights.push(t);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setAttribute('plantRoot',new THREE.Float32BufferAttribute(roots,2));
  geometry.setAttribute('plantHeight',new THREE.Float32BufferAttribute(heights,1));
  geometry.setIndex([0,1,2,1,3,2,2,3,4,3,5,4]);
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  geometry.userData.sharedCC0=true;
  return geometry;
}

export function makeGrassBlade(kind:GrassBladeKind):{near:THREE.Mesh;far:THREE.Mesh}{
  const material=new THREE.MeshStandardMaterial({
    name:`grass-${GRASS_BLADE_KINDS.indexOf(kind)}-darkness-tinted`,
    map:grassTuftMap(kind),color:0xffffff,
    roughness:1,metalness:0,side:THREE.DoubleSide,
    alphaTest:.42,alphaToCoverage:true,transparent:false,depthWrite:true,
  });
  const geometry=tuftGeometry(TUFTS[kind]);
  const near=new THREE.Mesh(geometry,material),far=new THREE.Mesh(geometry,material);
  near.name=`${kind}-near`;far.name=`${kind}-far`;
  return {near,far};
}
