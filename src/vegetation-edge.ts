import {FootprintIndex,polygonDistance} from './track-footprint';
import {vegetationGrowth,vegetationNoise} from './vegetation-distribution';
import {TERRAIN_SURFACE_OFFSET} from './terrain-mesh';

export const VEGETATION_EDGE_REACH=6;
export const VEGETATION_ROOT_OFFSET=TERRAIN_SURFACE_OFFSET-.006;

/** Distance to the actual union of road, kerbs and runoff, including nearby
 * road sections. A centreline offset would leave hard bands at tight corners. */
export function vegetationEdgeDistance(paved:FootprintIndex,x:number,z:number){
  let distance=VEGETATION_EDGE_REACH;
  for(const region of paved.query(x-distance,x+distance,z-distance,z+distance)){
    distance=Math.min(distance,polygonDistance(region.points,{x,z}));if(distance<=0)return distance;
  }
  return distance;
}

/** Shared density/height mask: mown edge -> sparse ordinary grass -> meadow.
 * Two noise scales disturb the contour without periodic bands or track IDs. */
export function vegetationEdgeWeight(distance:number,x:number,z:number){
  const edgeNoise=(vegetationNoise(x*.47+12.7,z*.47-9.3)-.5)*.8+(vegetationGrowth(x,z)-.5)*1.1;
  const t=Math.max(0,Math.min(1,(distance+edgeNoise-.12)/3.8));return t*t*(3-2*t);
}
