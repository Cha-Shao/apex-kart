import * as THREE from 'three';

/**
 * Two independent, exactly tileable fields packed into an RG texture.
 * Every octave samples a wrapped integer lattice, so both value and slope
 * meet at all four texture edges. The shader can repeat this texture forever.
 */
const SIZE=512;
const OCTAVE_WEIGHTS=[.48,.26,.14,.08,.04] as const;
const BROAD_PERIODS=[4,8,16,32,64] as const;
const DETAIL_PERIODS=[3,6,12,24,48] as const;

export const CLOUD_SHADOW_SPEED=1.5; // world metres / second
export const CLOUD_SHADOW_STRENGTH=.30; // max attenuation in the HDR composite

type Octave={period:number;weight:number;lattice:Float32Array};

function hash(x:number,y:number,seed:number){
  let value=Math.imul(x,0x1f123bb5)^Math.imul(y,0x5f356495)^seed;
  value=Math.imul(value^(value>>>16),0x7feb352d);
  value=Math.imul(value^(value>>>15),0x846ca68b);
  return ((value^(value>>>16))>>>0)/4294967295;
}

function makeOctaves(periods:readonly number[],seed:number):Octave[]{
  return periods.map((period,index)=>{
    const lattice=new Float32Array(period*period);
    for(let y=0;y<period;y++)for(let x=0;x<period;x++)
      lattice[y*period+x]=hash(x,y,seed+index*0x9e3779b9);
    return {period,weight:OCTAVE_WEIGHTS[index],lattice};
  });
}

function periodicFbm(u:number,v:number,octaves:Octave[]){
  let value=0;
  for(const {period,weight,lattice} of octaves){
    const px=u*period,py=v*period;
    const ix=Math.floor(px),iy=Math.floor(py);
    const fx=px-ix,fy=py-iy;
    // Quintic interpolation gives matching first and second derivatives.
    const sx=fx*fx*fx*(fx*(fx*6-15)+10);
    const sy=fy*fy*fy*(fy*(fy*6-15)+10);
    const x1=(ix+1)%period,y1=(iy+1)%period;
    const a=lattice[iy*period+ix],b=lattice[iy*period+x1];
    const c=lattice[y1*period+ix],d=lattice[y1*period+x1];
    value+=weight*(a+(b-a)*sx+(c+(d-c)*sx-a-(b-a)*sx)*sy);
  }
  return value;
}

export function createCloudShadowTexture(){
  const broad=makeOctaves(BROAD_PERIODS,0x3d7a9c21);
  const detail=makeOctaves(DETAIL_PERIODS,0x17e02f63);
  const data=new Uint8Array(SIZE*SIZE*2);
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    // Sample texel centres; REPEAT + LINEAR interpolates smoothly over seams.
    const u=(x+.5)/SIZE,v=(y+.5)/SIZE,i=(y*SIZE+x)*2;
    data[i]=Math.round(255*periodicFbm(u,v,broad));
    data[i+1]=Math.round(255*periodicFbm(u,v,detail));
  }
  const texture=new THREE.DataTexture(data,SIZE,SIZE,THREE.RGFormat,THREE.UnsignedByteType);
  texture.name='seamless-cloud-shadows-rg';
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;
  texture.needsUpdate=true;
  return texture;
}
