export interface VegetationSeed {x:number;z:number;priority:number;radius:number}

/** Integer-coordinate randomness is independent of tile loading order. */
export function vegetationHash(x:number,z:number,salt=0){
  let value=(Math.imul(x,0x1f123bb5)^Math.imul(z,0x5f356495)^salt)>>>0;
  value=Math.imul(value^(value>>>16),0x7feb352d);value=Math.imul(value^(value>>>15),0x846ca68b);
  return ((value^(value>>>16))>>>0)/4294967296;
}

export function vegetationNoise(x:number,z:number){
  const ix=Math.floor(x),iz=Math.floor(z),u=x-ix,v=z-iz,s=u*u*(3-2*u),t=v*v*(3-2*v);
  const a=vegetationHash(ix,iz,137),b=vegetationHash(ix+1,iz,137),c=vegetationHash(ix,iz+1,137),d=vegetationHash(ix+1,iz+1,137);
  return (a+(b-a)*s)*(1-t)+(c+(d-c)*s)*t;
}

/** Coherent growth variation has no periodic sine-wave bands. */
export const vegetationGrowth=(x:number,z:number)=>.64*vegetationNoise(x*.035+19.3,z*.035-7.1)+.26*vegetationNoise(x*.093-3.9,z*.093+31.7)+.1*vegetationNoise(x*.217+11.2,z*.217+5.6);

/** Priority-thinned hard-core samples, inspired by Poisson-disk blue noise.
 * The hash grid only accelerates neighbour queries; candidates can be anywhere
 * in each cell. The neighbour halo is global, so tile borders do not form rows. */
export function meadowSeeds(minX:number,minZ:number,maxX:number,maxZ:number){
  const cell=1.5,candidates=new Map<string,VegetationSeed>(),points:VegetationSeed[]=[];
  const candidate=(ix:number,iz:number)=>{
    const key=`${ix},${iz}`;let point=candidates.get(key);if(point)return point;
    const x=(ix+vegetationHash(ix,iz,431))*cell,z=(iz+vegetationHash(ix,iz,997))*cell;
    point={x,z,priority:vegetationHash(ix,iz,1913),radius:1.03+vegetationGrowth(x,z)*.5};candidates.set(key,point);return point;
  };
  for(let iz=Math.floor(minZ/cell);iz<Math.ceil(maxZ/cell);iz++)for(let ix=Math.floor(minX/cell);ix<Math.ceil(maxX/cell);ix++){
    const point=candidate(ix,iz);if(point.x<minX||point.x>=maxX||point.z<minZ||point.z>=maxZ)continue;
    let retained=true;
    for(let dz=-2;dz<=2&&retained;dz++)for(let dx=-2;dx<=2;dx++){
      if(!dx&&!dz)continue;
      const other=candidate(ix+dx,iz+dz);
      if(other.priority>point.priority||other.priority===point.priority&&(other.x>point.x||other.x===point.x&&other.z>point.z))continue;
      const radius=Math.max(point.radius,other.radius);
      if((point.x-other.x)**2+(point.z-other.z)**2<radius*radius){retained=false;break;}
    }
    if(retained)points.push(point);
  }
  return points;
}
