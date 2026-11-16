import type {CircuitPreset} from './circuit-library';
import {parseTerrain,TerrainField,type TerrainData} from './terrain';
import {roadTerrain} from './road-terrain';

const cache=new Map<string,Promise<TerrainData>>();
export const CIRCUIT_TERRAIN_VERSION=1;
/** Fetch bundled assets only. Each caller gets a mutable copy for the height brush. */
export async function circuitTerrain(circuit:CircuitPreset,scale:'native'|'compact',saved?:TerrainField,preserveSaved=false){
  let pending=cache.get(circuit.id);
  if(!pending){
    pending=fetch(`/data/elevation/${encodeURIComponent(circuit.id)}.json`).then(async response=>{
      if(!response.ok)throw new Error('赛道高度文件加载失败，请重新载入。');
      return parseTerrain(await response.json()).toJSON();
    }).catch(error=>{cache.delete(circuit.id);throw error;});
    cache.set(circuit.id,pending);
  }
  const data=await pending,compact=scale==='compact',factor=compact?circuit.compactScale:1;
  if(saved){
    // Older exports omitted the DEM datum. Restore metadata without changing
    // the saved height brush or the user's explicit water setting.
    if(saved.datumM===undefined&&data.datumM!==undefined){saved.datumM=data.datumM*factor;saved.revision++;}
    if(preserveSaved)return saved;
    // Legacy saves did not identify height-brush edits. Only replace a field
    // that still matches the old generator, including its incorrect 1/3 scale.
    const legacyFactor=compact?1/3:1;
    const generated=saved.resolution===data.resolution&&Math.abs(saved.size-data.size*factor)<.001&&Math.abs(saved.originX-data.originX*factor)<.001&&Math.abs(saved.originZ-data.originZ*factor)<.001&&data.heights.every((h,i)=>Math.abs(saved.heights[i]-h*legacyFactor)<.0011);
    if(!generated)return saved;
  }
  const source=new TerrainField({...data,size:data.size*factor,originX:data.originX*factor,originZ:data.originZ*factor,heights:data.heights.map(h=>h*factor),datumM:data.datumM===undefined?undefined:data.datumM*factor,waterLevel:saved?.waterLevel??(typeof data.waterLevel==='number'?data.waterLevel*factor:data.waterLevel),waterEnabled:saved?.waterEnabled??data.waterEnabled});
  return roadTerrain(source,compact?circuit.compactPoints:circuit.nativePoints,compact?6:12,compact);
}
