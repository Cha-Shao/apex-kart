import type {CircuitPreset} from './circuit-library';
import {parseTerrain,TerrainField,type TerrainData} from './terrain';

const cache=new Map<string,Promise<TerrainData>>();
/** Fetch bundled assets only. Each caller gets a mutable copy for the height brush. */
export async function circuitTerrain(circuit:CircuitPreset,scale:'native'|'compact'){
  let pending=cache.get(circuit.id);
  if(!pending){
    pending=fetch(`/data/elevation/${encodeURIComponent(circuit.id)}.json`).then(async response=>{
      if(!response.ok)throw new Error('赛道高度文件加载失败，请重新载入。');
      return parseTerrain(await response.json()).toJSON();
    }).catch(error=>{cache.delete(circuit.id);throw error;});
    cache.set(circuit.id,pending);
  }
  const data=await pending,factor=scale==='compact'?circuit.compactScale:1;
  return new TerrainField({...data,size:data.size*factor,originX:data.originX*factor,originZ:data.originZ*factor,heights:data.heights.map(h=>h*factor)});
}
