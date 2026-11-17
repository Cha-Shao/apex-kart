import * as THREE from 'three';

/** Keep the visible HDR intact, but remove its solar disc from sky lighting.
 * The aligned, shadow-casting directional light supplies that energy instead. */
export function daylightSky(texture:THREE.DataTexture){
  const {data,width,height}=texture.image as {data:Uint16Array;width:number;height:number};
  const luminance=(offset:number)=>.2126*THREE.DataUtils.fromHalfFloat(data[offset])+.7152*THREE.DataUtils.fromHalfFloat(data[offset+1])+.0722*THREE.DataUtils.fromHalfFloat(data[offset+2]);
  let peak=0,sunX=0,sunY=0;
  for(let y=0;y<Math.floor(height/2);y++)for(let x=0;x<width;x++){
    const value=luminance((y*width+x)*4);
    if(Number.isFinite(value)&&value>peak){peak=value;sunX=x;sunY=y;}
  }
  // HDRLoader uploads top-to-bottom pixels with flipY=true. This is the
  // inverse of Three.js equirectUv(), including the half-pixel sample centre.
  const azimuth=((sunX+.5)/width-.5)*Math.PI*2,elevation=(.5-(sunY+.5)/height)*Math.PI;
  const sunDirection=new THREE.Vector3(Math.cos(elevation)*Math.cos(azimuth),Math.sin(elevation),Math.cos(elevation)*Math.sin(azimuth));
  const inner=Math.cos(THREE.MathUtils.degToRad(.75)),outer=Math.cos(THREE.MathUtils.degToRad(1.5)),ring=Math.cos(THREE.MathUtils.degToRad(4));
  const cosLongitude=Float32Array.from({length:width},(_,x)=>Math.cos(((x+.5)/width-.5)*Math.PI*2-azimuth));
  const disc:{offset:number;alignment:number}[]=[],skyColour=new THREE.Vector3();let weight=0;
  for(let y=0;y<Math.floor(height/2);y++){
    const latitude=(.5-(y+.5)/height)*Math.PI,cosLatitude=Math.cos(latitude),sinLatitude=Math.sin(latitude);
    for(let x=0;x<width;x++){
      const alignment=sinLatitude*sunDirection.y+cosLatitude*Math.cos(elevation)*cosLongitude[x];
      if(alignment<ring)continue;
      const offset=(y*width+x)*4;
      if(alignment>outer){disc.push({offset,alignment});continue;}
      // Solid-angle weighting avoids over-representing rows near the pole.
      skyColour.x+=THREE.DataUtils.fromHalfFloat(data[offset])*cosLatitude;
      skyColour.y+=THREE.DataUtils.fromHalfFloat(data[offset+1])*cosLatitude;
      skyColour.z+=THREE.DataUtils.fromHalfFloat(data[offset+2])*cosLatitude;weight+=cosLatitude;
    }
  }
  const pixels=new Uint16Array(data);
  if(weight>0){
    skyColour.multiplyScalar(1/weight);
    for(const {offset,alignment} of disc){
      const blend=THREE.MathUtils.smoothstep(alignment,outer,inner);
      for(let channel=0;channel<3;channel++){
        const original=THREE.DataUtils.fromHalfFloat(data[offset+channel]);
        pixels[offset+channel]=THREE.DataUtils.toHalfFloat(THREE.MathUtils.lerp(original,Math.min(original,skyColour.getComponent(channel)),blend));
      }
    }
  }
  const sky=new THREE.DataTexture(pixels,width,height,THREE.RGBAFormat,THREE.HalfFloatType);
  sky.name='HDR-sky-without-direct-sun';sky.mapping=THREE.EquirectangularReflectionMapping;sky.colorSpace=texture.colorSpace;sky.flipY=texture.flipY;
  sky.minFilter=THREE.LinearFilter;sky.magFilter=THREE.LinearFilter;sky.generateMipmaps=false;sky.needsUpdate=true;
  return {sky,sunDirection};
}
