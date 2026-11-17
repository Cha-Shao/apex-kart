import * as THREE from 'three';
import {bridgeHeight,curbWidth,roadFootprint,type Point,type TrackData} from './track';
import {FootprintIndex,polygonDistance} from './track-footprint';
import {surfaceTrack} from './surface-track';
import type {TerrainField} from './terrain';
import {MeadowField,type MeadowEdge} from './meadow';
import {vegetationGrowth} from './vegetation-distribution';
import {vegetationEdgeWeight,VEGETATION_EDGE_REACH} from './vegetation-edge';

const CELL_SIZE=24,WIND_REACH=.065;
const GRASS=['grass-short-a','grass-short-b','grass-tall-a','grass-tall-b'] as const;
const WEEDS=['weed-a','weed-b'] as const,SHRUBS=['shrub-a','shrub-b'] as const;
const MEADOW=['meadow-a','meadow-b'] as const;
type PlantKind=typeof GRASS[number]|typeof WEEDS[number]|typeof SHRUBS[number]|typeof MEADOW[number];
type LandPlacement=(p:Point,margin?:number)=>boolean;
interface Plant extends Point {y:number;scale:number;stretch:number;rotation:number;slopeX:number;slopeZ:number;tint:THREE.Color}
export interface PlantModel {near:THREE.Mesh;far:THREE.Mesh;radius:number;height:number;patch:boolean;lodStart:number;lodEnd:number;fadeStart:number;fadeEnd:number}

function seeded(initial:number){let seed=initial;return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}

/** Artist-authored CC0 plants, shared PBR atlases and two instanced mesh LODs. */
export class GrassField extends THREE.Group {
  private readonly time={value:0};
  private readonly view={value:new THREE.Vector3()};
  private readonly terrainHeights={value:null as THREE.DataTexture|null};
  private readonly terrainGrid={value:new THREE.Vector4()};
  private readonly fullGrowth=new THREE.DataTexture(new Uint8Array([255]),1,1,THREE.RedFormat,THREE.UnsignedByteType);
  private meadow:MeadowField|null=null;
  private readonly cells:{meshes:THREE.InstancedMesh[];center:THREE.Vector3;radius:number;model:PlantModel}[]=[];

  constructor(track:TrackData,terrain:TerrainField,woodland:readonly Point[],land:LandPlacement,source?:THREE.Group){
    super();this.name='photographic-grass-weeds-and-shrubs';
    this.fullGrowth.needsUpdate=true;
    // Local GLB loading is followed by the normal scenery rebuild. Do not
    // substitute the old untextured ribbons while the real plants load.
    if(!source)return;
    const models=new Map<PlantKind,PlantModel>();
    for(const kind of [...GRASS,...WEEDS,...SHRUBS,...MEADOW]){
      const near=source.getObjectByName(`${kind}-near`),far=source.getObjectByName(`${kind}-far`);
      if(!(near instanceof THREE.Mesh)||!(far instanceof THREE.Mesh))continue;
      let radius=0,height=0;
      for(const mesh of [near,far]){
        const geometry=mesh.geometry;
        const root=geometry.getAttribute('_plant_root'),heightAttribute=geometry.getAttribute('_plant_height');
        if(root)geometry.setAttribute('plantRoot',root);
        if(heightAttribute)geometry.setAttribute('plantHeight',heightAttribute);
        // Explicit artist/baked root weights still need the same wind bounds.
        if(!geometry.userData.grassWindBounds){geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.boundingSphere!.radius+=WIND_REACH;geometry.userData.grassWindBounds=true;}
        if(!geometry.getAttribute('plantHeight')){
          const bounds=geometry.boundingBox!,positions=geometry.getAttribute('position'),heights=new Float32Array(positions.count);
          for(let i=0;i<positions.count;i++)heights[i]=THREE.MathUtils.clamp((positions.getY(i)-bounds.min.y)/Math.max(.001,bounds.max.y-bounds.min.y),0,1);
          geometry.setAttribute('plantHeight',new THREE.BufferAttribute(heights,1));
        }
        const bounds=geometry.boundingBox!;
        radius=Math.max(radius,Math.hypot(Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z))));
        height=Math.max(height,bounds.max.y-bounds.min.y);
      }
      const shrub=kind.startsWith('shrub'),weed=kind.startsWith('weed'),patch=kind.startsWith('meadow');
      models.set(kind,{near,far,radius,height,patch,lodStart:patch?16:shrub?30:weed?15:12,lodEnd:patch?32:shrub?52:weed?28:24,fadeStart:patch?88:shrub?130:weed?58:48,fadeEnd:patch?136:shrub?195:weed?105:96});
    }
    if(!models.size)return;
    const random=seeded(813),dense=surfaceTrack(track),n=dense.samples.length;
    const paved=new FootprintIndex([...roadFootprint(dense.samples,dense.features,dense.width),...dense.runoffRegions]);
    const meadowModels=MEADOW.map(kind=>models.get(kind)).filter((model):model is PlantModel=>!!model);
    if(meadowModels.length){
      const texture=new THREE.DataTexture(terrain.heights,terrain.resolution,terrain.resolution,THREE.RedFormat,THREE.FloatType);
      texture.name='meadow-shared-terrain-heights';texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
      this.terrainHeights.value=texture;this.terrainGrid.value.set(terrain.originX,terrain.originZ,terrain.cellSize,terrain.resolution);
      this.meadow=new MeadowField(track,terrain,land,paved,meadowModels,(source,model,level,birth,edge)=>this.plantMaterial(source,model,level,birth,edge));this.add(this.meadow);
    }
    const placements=new Map<PlantKind,Map<string,Plant[]>>(),occupied=new Set<string>();
    const plant=(kind:PlantKind,x:number,z:number,scale:number,stretch=1,trimmed=false)=>{
      const model=models.get(kind);if(!model)return;
      const y=terrain.sample(x,z),dx=(terrain.sample(x+.25,z)-terrain.sample(x-.25,z))/.5,dz=(terrain.sample(x,z+.25)-terrain.sample(x,z-.25))/.5,slope=Math.hypot(dx,dz);
      if(slope>1.05)return;
      // Include the sideways reach of leaves on sloping banks, not just the
      // footprint of an upright source model.
      const p={x,z},clearance=(model.radius+model.height*stretch*slope/Math.hypot(1,slope)+WIND_REACH)*scale;
      if(!land(p,clearance))return;
      if(Math.abs(x+12)<65&&z>track.bounds.maxZ+10&&z<track.bounds.maxZ+45)return;
      const reach=Math.max(clearance,VEGETATION_EDGE_REACH);let edgeDistance=reach;
      for(const region of paved.query(x-reach,x+reach,z-reach,z+reach)){
        const distance=polygonDistance(region.points,p);if(distance<clearance)return;edgeDistance=Math.min(edgeDistance,distance);
      }
      if(!trimmed&&!kind.startsWith('shrub')){
        const growth=vegetationEdgeWeight(edgeDistance,x,z);if(random()>.12+.88*growth)return;
        stretch*=.4+.6*growth;
      }
      const spacing=kind.startsWith('shrub')?.8:.18,key=`${kind.startsWith('shrub')?'bush':'ground'}/${Math.floor(x/spacing)},${Math.floor(z/spacing)}`;
      if(occupied.has(key))return;
      occupied.add(key);
      const cells=placements.get(kind)??new Map<string,Plant[]>(),cellKey=`${Math.floor(x/CELL_SIZE)},${Math.floor(z/CELL_SIZE)}`,cell=cells.get(cellKey)??[];
      // The source diffuse carries leaf veins, dry tips and species colour.
      // A small neutral variation preserves that albedo instead of bleaching
      // every blade into the same yellow-green strip.
      const tint=new THREE.Color().setRGB(.84+random()*.12,.87+random()*.1,.8+random()*.13);
      cell.push({x,y:y-.031,z,scale,stretch,rotation:random()*Math.PI*2,slopeX:dx,slopeZ:dz,tint});
      cells.set(cellKey,cell);placements.set(kind,cells);
    };
    const edge=(i:number,side:number)=>dense.width*.5+curbWidth(dense.width)*(side>0?dense.features.left:dense.features.right)[i]+(side>0?dense.features.gravelLeft:dense.features.gravelRight)[i];

    // Broad growth patches break up a connected, low verge. Short grass is
    // closest to the track; occasional taller shoots and weeds sit behind it.
    const stations=Math.min(4000,Math.ceil(track.length/.65));
    for(let k=0;k<stations;k++){
      const u=(k+random())/stations*n,i=Math.floor(u),j=(i+1)%n,t=u-i,a=dense.samples[i],b=dense.samples[j];
      if(bridgeHeight(dense,i)>.02||bridgeHeight(dense,j)>.02)continue;
      const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,nx=a.nx+(b.nx-a.nx)*t,nz=a.nz+(b.nz-a.nz)*t;
      for(const side of [-1,1]){
        const roadEdge=edge(i,side)+(edge(j,side)-edge(i,side))*t;
        const patch=vegetationGrowth(x+side*7.3,z-side*11.7),band=.75+patch*2.6;
        for(let tuft=0;tuft<12;tuft++){
          if(random()>.7+patch*.25)continue;
          const outside=.2+random()**1.4*band,offset=(roadEdge+outside)*side,along=(random()-.5)*track.length/stations*1.4;
          const tall=outside>.8&&random()<.28,weed=outside>.65&&random()<.09;
          const kind=weed?WEEDS[Math.floor(random()*2)]:GRASS[(tall?2:0)+Math.floor(random()*2)];
          plant(kind,x+nx*offset+a.tx*along,z+nz*offset+a.tz*along,.85+random()*.5,.82+random()*.3);
        }
      }
    }
    // Fine, short growth against exposed kerbs keeps the transition attached
    // to the turf. Radius-based exclusions protect asphalt and white lines.
    const seams=Math.min(5000,Math.ceil(track.length/.5));
    for(let k=0;k<seams;k++){
      const u=(k+random())/seams*n,i=Math.floor(u),j=(i+1)%n,t=u-i,a=dense.samples[i],b=dense.samples[j];
      if(bridgeHeight(dense,i)>.02||bridgeHeight(dense,j)>.02)continue;
      for(const side of [-1,1]){
        const roadEdge=edge(i,side)+(edge(j,side)-edge(i,side))*t,nx=a.nx+(b.nx-a.nx)*t,nz=a.nz+(b.nz-a.nz)*t;
        for(let stage=0;stage<3;stage++){
          if(random()>(stage===0?.78:stage===1?.55:.48))continue;
          const outside=stage===0?.06+random()*.25:stage===1?.25+random()*1.1:.9+random()*2.4,offset=(roadEdge+outside)*side,along=(random()-.5)*.8;
          const px=a.x+(b.x-a.x)*t+nx*offset+a.tx*along,pz=a.z+(b.z-a.z)*t+nz*offset+a.tz*along;
          const kind=GRASS[Math.floor(random()*(stage===0?2:4))];
          plant(kind,px,pz,stage===0?.22+random()*.2:.48+random()*.48,stage===0?.5+random()*.25:.7+random()*.35,stage===0);
        }
      }
    }
    // Real small shrubs replace the former scaled-down ash tree crowns.
    // Their skirts mix low leaves and grass, leaving open ground between
    // woodland patches rather than densely planting the entire heightfield.
    for(const shrub of woodland){
      plant(SHRUBS[Math.floor(random()*2)],shrub.x,shrub.z,.75+random()*.4,.85+random()*.25);
      for(let k=0;k<12;k++){
        const angle=random()*Math.PI*2,radius=.35+Math.sqrt(random())*1.4,kind=random()<.28?WEEDS[Math.floor(random()*2)]:GRASS[Math.floor(random()*4)];
        plant(kind,shrub.x+Math.cos(angle)*radius,shrub.z+Math.sin(angle)*radius,.95+random()*.4,.8+random()*.35);
      }
    }

    const dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0),normal=new THREE.Vector3();
    for(const [kind,cells] of placements){
      const model=models.get(kind)!,materials=[this.plantMaterial(model.near.material,model,0),this.plantMaterial(model.far.material,model,1)];
      for(const cell of cells.values()){
        const center=new THREE.Vector3(cell.reduce((sum,p)=>sum+p.x,0)/cell.length,cell.reduce((sum,p)=>sum+p.y,0)/cell.length,cell.reduce((sum,p)=>sum+p.z,0)/cell.length);
        const meshes=[model.near,model.far].map((source,level)=>{
          const mesh=new THREE.InstancedMesh(source.geometry,materials[level],cell.length);mesh.name=`${kind}-${level===0?'near':'far'}-instances`;mesh.position.copy(center);
          cell.forEach((p,i)=>{
            dummy.position.set(p.x-center.x,p.y-center.y,p.z-center.z);dummy.quaternion.setFromUnitVectors(up,normal.set(-p.slopeX,1,-p.slopeZ).normalize());dummy.rotateY(p.rotation);
            dummy.scale.set(p.scale,p.scale*p.stretch,p.scale);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,p.tint);
          });
          // No per-blade shadow draws or physics; opaque cutouts retain real
          // depth occlusion and receive the normal track/woodland shadows.
          mesh.receiveShadow=true;mesh.computeBoundingSphere();this.add(mesh);return mesh;
        });
        // Bound anchors separately from the slightly different LOD shapes.
        const radius=Math.max(...cell.map(p=>Math.hypot(p.x-center.x,p.y-center.y,p.z-center.z)));
        this.cells.push({meshes,center,radius,model});
      }
    }
  }

  private plantMaterial(source:THREE.Material|THREE.Material[],model:PlantModel,level:number,birth=-1000,edge?:MeadowEdge){
    const original=Array.isArray(source)?source[0]:source;
    const material=(original as THREE.MeshStandardMaterial).clone();material.userData.sharedCC0=false;
    material.name=`${original.name}-lod-${level}`;material.transparent=false;material.alphaTest=.4;material.alphaToCoverage=true;
    material.side=THREE.DoubleSide;material.depthTest=true;material.depthWrite=true;material.roughness=1;material.metalness=0;material.envMapIntensity=.6;material.aoMapIntensity=.28;
    material.normalScale.multiplyScalar(model.patch?.55:.75);
    material.onBeforeCompile=shader=>{
      shader.uniforms.plantTime=this.time;shader.uniforms.plantViewPosition=this.view;
      shader.uniforms.plantBirth={value:birth};
      if(model.patch){
        shader.uniforms.plantTerrain=this.terrainHeights;shader.uniforms.plantTerrainGrid=this.terrainGrid;
        shader.uniforms.plantEdgeMask={value:edge?.texture??this.fullGrowth};shader.uniforms.plantEdgeBounds={value:edge?.bounds??new THREE.Vector4(0,0,1,1)};
      }
      shader.vertexShader=shader.vertexShader
        .replace('#include <common>',`#include <common>
          uniform float plantTime;uniform float plantBirth;uniform vec3 plantViewPosition;
          attribute float plantHeight;
          varying float vPlantHeight;varying float vPlantDistance;varying float vPlantJitter;varying float vPlantReady;varying float vPlantVisible;
          ${model.patch?`
          attribute vec2 plantRoot;
          uniform sampler2D plantTerrain;uniform vec4 plantTerrainGrid;
          uniform sampler2D plantEdgeMask;uniform vec4 plantEdgeBounds;
          float plantGround(vec2 world){
            vec2 grid=clamp((world-plantTerrainGrid.xy)/plantTerrainGrid.z,vec2(0.0),vec2(plantTerrainGrid.w-1.0));
            ivec2 cell=ivec2(min(floor(grid),vec2(plantTerrainGrid.w-2.0)));
            vec2 t=grid-vec2(cell);
            float a=texelFetch(plantTerrain,cell,0).r,b=texelFetch(plantTerrain,cell+ivec2(1,0),0).r;
            float c=texelFetch(plantTerrain,cell+ivec2(0,1),0).r,d=texelFetch(plantTerrain,cell+ivec2(1,1),0).r;
            return t.x>t.y?a+(b-a)*t.x+(d-b)*t.y:a+(d-c)*t.x+(c-a)*t.y;
          }`:''}
        `)
        .replace('#include <begin_vertex>',`#include <begin_vertex>
          vec4 plantAnchor=${model.patch?'vec4(plantRoot.x,0.0,plantRoot.y,1.0)':'vec4(0.0,0.0,0.0,1.0)'};
          #ifdef USE_INSTANCING
          plantAnchor=instanceMatrix*plantAnchor;
          #endif
          vec3 plantWorld=(modelMatrix*plantAnchor).xyz;
          vPlantVisible=1.0;float plantGrowth=1.0;
          ${model.patch?`
          plantGrowth=texture2D(plantEdgeMask,(plantWorld.xz-plantEdgeBounds.xy)/plantEdgeBounds.zw).r;
          float rootNoise=fract(sin(dot(plantWorld.xz,vec2(43.719,17.631)))*18473.731);
          vPlantVisible=step(rootNoise,mix(.04,1.0,smoothstep(0.0,.95,plantGrowth)));
          transformed.y*=.18+.82*plantGrowth;
          float ground=plantGround(plantWorld.xz)-.031;
          float verticalScale=1.0;
          #ifdef USE_INSTANCING
          verticalScale=length((modelMatrix*instanceMatrix*vec4(0.0,1.0,0.0,0.0)).xyz);
          #endif
          transformed.y+=(ground-plantWorld.y)/max(.01,verticalScale);plantWorld.y=ground;
          `:''}
          vPlantDistance=distance(plantWorld,plantViewPosition);vPlantHeight=plantHeight;
          vPlantReady=smoothstep(0.0,.5,plantTime-plantBirth);
          vPlantJitter=fract(sin(dot(plantWorld.xz,vec2(12.9898,78.233)))*43758.5453)*7.0;
          float wave=sin(plantWorld.x*.63+plantWorld.z*.42+plantTime*1.55);
          float flutter=sin(plantWorld.z*1.6-plantTime*2.1+position.y*9.0);
          transformed.x+=(wave*.018+flutter*.006)*plantHeight*plantHeight*(.3+.7*plantGrowth);
          transformed.z+=wave*.012*plantHeight*plantHeight*(.3+.7*plantGrowth);
        `);
      shader.fragmentShader=shader.fragmentShader
        .replace('#include <common>','#include <common>\nvarying float vPlantHeight;varying float vPlantDistance;varying float vPlantJitter;varying float vPlantReady;varying float vPlantVisible;')
        .replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
          if(vPlantVisible<.5)discard;
          float plantNear=1.0-smoothstep(${model.lodStart.toFixed(1)},${model.lodEnd.toFixed(1)},vPlantDistance);
          float plantFade=1.0-smoothstep(${model.fadeStart.toFixed(1)}-vPlantJitter,${model.fadeEnd.toFixed(1)}-vPlantJitter,vPlantDistance);
          float plantNoise=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
          ${level===0?'if(plantNoise>=plantNear)discard;':'if(plantNoise<plantNear||plantNoise>=plantFade)discard;'}
          if(fract(plantNoise+.381966)>vPlantReady)discard;
        `)
        .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=max(.88,roughnessFactor);')
        .replace('#include <lights_physical_fragment>','#include <lights_physical_fragment>\nmaterial.specularColor*=.35;material.specularF90*=.35;')
        .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
          // A thin leaf receives sky from both sides. Keep its actual normals
          // and borrow back-face irradiance instead of adding unlit colour.
          vec3 plantBackIrradiance=getAmbientLightIrradiance(ambientLightColor);
          #if defined(USE_LIGHT_PROBES)
          plantBackIrradiance+=getLightProbeIrradiance(lightProbe,-geometryNormal);
          #endif
          #if NUM_HEMI_LIGHTS > 0
          #pragma unroll_loop_start
          for(int i=0;i<NUM_HEMI_LIGHTS;i++){
            plantBackIrradiance+=getHemisphereLightIrradiance(hemisphereLights[i],-geometryNormal);
          }
          #pragma unroll_loop_end
          #endif
          #if defined(USE_ENVMAP) && defined(ENVMAP_TYPE_CUBE_UV)
          plantBackIrradiance+=getIBLIrradiance(-geometryNormal);
          #endif
          vec3 plantTransmissionTint=vec3(.94,1.0,.82);
          reflectedLight.indirectDiffuse=reflectedLight.indirectDiffuse*.62+plantBackIrradiance*BRDF_Lambert(material.diffuseColor)*plantTransmissionTint*.38;
          reflectedLight.indirectDiffuse*=mix(.96,1.0,vPlantHeight);
          #if NUM_DIR_LIGHTS == 1
          // Cheap two-sided foliage wrap / transmission, following the
          // published Crytek approach. Sun shadowing also gates this BTDF.
          float plantNoL=dot(geometryNormal,directionalLights[0].direction);
          float plantWrap=max(0.0,clamp((plantNoL+.35)/1.35,0.0,1.0)-max(plantNoL,0.0));
          float plantPhase=pow(max(dot(geometryViewDir,-directionalLights[0].direction),0.0),4.0);
          float plantThin=mix(.2,.48,smoothstep(.05,.9,vPlantHeight));
          float plantBacklight=max(-plantNoL,0.0)*plantThin*(.65+.35*plantPhase);
          reflectedLight.directDiffuse+=directLight.color*BRDF_Lambert(material.diffuseColor)*(vec3(plantWrap*.45)+plantTransmissionTint*plantBacklight);
          #endif
        `);
    };
    material.customProgramCacheKey=()=>`two-sided-edge-groundcover-v4-${model.patch}-${level}-${model.lodStart}-${model.lodEnd}-${model.fadeStart}-${model.fadeEnd}`;return material;
  }

  update(time:number,view:THREE.Vector3){
    this.time.value=time;this.view.value.copy(view);
    this.meadow?.update(time,view);
    for(const {meshes,center,radius,model} of this.cells){
      const distance=center.distanceTo(view),near=Math.max(0,distance-radius),far=distance+radius;
      meshes[0].visible=near<model.lodEnd;
      meshes[1].visible=far>model.lodStart&&near<model.fadeEnd;
    }
  }

  dispose(){this.meadow?.dispose();this.terrainHeights.value?.dispose();this.terrainHeights.value=null;this.fullGrowth.dispose();}
}
