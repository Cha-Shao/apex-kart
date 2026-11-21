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

/** Large, continuous cover field. Lower noise values mean denser grass;
 * broad open areas and full areas blend naturally instead of discrete colonies. */
export function vegetationCoverDensity(x:number,z:number){
  const broad=vegetationNoise(x*.022+37.1,z*.022-12.7);
  const detail=vegetationNoise(x*.068-8.3,z*.068+21.6);
  const breakup=vegetationNoise(x*.24+13.1,z*.24-17.6);
  const value=broad*.75+detail*.2+breakup*.05;
  const t=Math.max(0,Math.min(1,(.72-value)/.4));
  return t*t*(3-2*t);
}

/** One candidate = one entire textured grass tuft; no preset clump shapes.
 * World-space jitter is stable across tile boundaries. At 0.25/sqrt(2)m,
 * the base candidate count doubles from 16 to 32 per m² while the same
 * broad density and land-exclusion masks continue to determine survivors. */
export function* grassTuftSeeds(minX:number,minZ:number,maxX:number,maxZ:number){
  const cell=.25/Math.SQRT2;
  for(let iz=Math.floor(minZ/cell);iz<Math.ceil(maxZ/cell);iz++){
    for(let ix=Math.floor(minX/cell);ix<Math.ceil(maxX/cell);ix++){
      const x=(ix+.09+vegetationHash(ix,iz,431)*.82)*cell;
      const z=(iz+.09+vegetationHash(ix,iz,997)*.82)*cell;
      if(x>=minX&&x<maxX&&z>=minZ&&z<maxZ)yield {x,z,ix,iz};
    }
  }
}

