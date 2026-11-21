export const fullscreenVertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;

export const volumeFragment=`
varying vec2 vUv;
uniform sampler2D sceneDepth,shadow0,shadow1,shadow2;
uniform mat4 inverseProjection,cameraWorld,worldToView,shadowMatrix0,shadowMatrix1,shadowMatrix2;
uniform vec3 sunDirection,sunColour;
uniform vec2 shadowSplits;
uniform float cameraNear,cameraFar,frameIndex,baseHeight;
#include <packing>
vec3 viewPosition(vec2 uv,float d){vec4 p=inverseProjection*vec4(uv*2.0-1.0,d*2.0-1.0,1.0);return p.xyz/p.w;}
float shadowAt(sampler2D map,mat4 matrix,vec3 world){
  vec4 p=matrix*vec4(world,1.0);vec3 q=p.xyz/p.w;
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,vec3(1.0))))return 1.0;
  vec2 t=vec2(1.0/2048.0);float result=0.0;
  result+=step(q.z-.00008,unpackRGBAToDepth(texture2D(map,q.xy+t*vec2(-.5,-.5))));
  result+=step(q.z-.00008,unpackRGBAToDepth(texture2D(map,q.xy+t*vec2(.5,.5))));
  return result*.5;
}
float sunlight(vec3 world){
  float z=-(worldToView*vec4(world,1.0)).z;
  if(z<shadowSplits.x)return shadowAt(shadow0,shadowMatrix0,world);
  if(z<shadowSplits.y)return shadowAt(shadow1,shadowMatrix1,world);
  return shadowAt(shadow2,shadowMatrix2,world);
}
void main(){
  float d=texture2D(sceneDepth,vUv).r;vec3 end=viewPosition(vUv,d);
  vec3 origin=cameraWorld[3].xyz;
  vec3 direction=normalize(mat3(cameraWorld)*normalize(end));
  float distanceToSurface=d>=.999999?320.0:length(end);
  float distanceToMarch=min(distanceToSurface,280.0),stepLength=distanceToMarch/24.0;
  float noise=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))+frameIndex*.071));
  float cosine=dot(direction,sunDirection),g=.68;
  float phase=(1.0-g*g)/(12.5663706*pow(max(.02,1.0+g*g-2.0*g*cosine),1.5));
  float transmittance=1.0;vec3 scatter=vec3(0.0);
  for(int i=0;i<24;i++){
    float t=(float(i)+noise)*stepLength;vec3 world=origin+direction*t;
    float density=.0016*exp(-max(world.y-baseHeight,0.0)*.025);
    float extinction=exp(-density*stepLength);
    scatter+=transmittance*(1.0-extinction)*sunlight(world)*sunColour*phase;
    transmittance*=extinction;
  }
  // Surface fog already supplies broad atmospheric extinction. This pass
  // integrates only shadowed single-scattered sunlight, avoiding double fog.
  gl_FragColor=vec4(scatter,log2(1.0+distanceToSurface));
}`;

export const combineFragment=`
varying vec2 vUv;
uniform sampler2D sceneColour,sceneDepth,ambientOcclusion,volume,cloudShadowMap;
uniform vec2 halfResolution;
uniform mat4 inverseProjection,cameraWorld;
uniform vec3 cloudSunDirection;
uniform float cloudTime,cloudWindSpeed,cloudShadowStrength;
vec3 viewPosition(vec2 uv,float d){vec4 p=inverseProjection*vec4(uv*2.0-1.0,d*2.0-1.0,1.0);return p.xyz/p.w;}
float cloudOcclusion(vec3 world){
  // Project surface points towards a high cloud plane along the HDR sun.
  vec2 sunReach=cloudSunDirection.xz/max(cloudSunDirection.y,.28);
  vec2 cloudPlane=world.xz+sunReach*(1450.0-world.y);
  // Both independently generated channels repeat perfectly at their edges.
  // Separate physical scales and wind velocities break up visible tiling.
  vec2 broadWind=vec2(.88,.475)*cloudTime*cloudWindSpeed;
  vec2 detailWind=vec2(.94,.342)*cloudTime*(cloudWindSpeed*.62);
  float broad=texture2D(cloudShadowMap,(cloudPlane-broadWind)/1200.0).r;
  float detail=texture2D(cloudShadowMap,(cloudPlane-detailWind+vec2(327.0,-579.0))/600.0).g;
  // Narrower density transition makes both bright gaps and deep cloud cover
  // visually distinct while preserving continuously soft, seamless edges.
  return cloudShadowStrength*smoothstep(.47,.56,mix(broad,detail,.18));
}
void main(){
  float d=texture2D(sceneDepth,vUv).r;vec3 p=viewPosition(vUv,d);
  float depthLog=log2(1.0+length(p)),weight=0.0,ao=0.0;vec3 light=vec3(0.0);
  vec2 grid=vUv*halfResolution-.5,cell=floor(grid),f=fract(grid);
  for(int y=0;y<2;y++)for(int x=0;x<2;x++){
    vec2 uv=(cell+vec2(float(x),float(y))+.5)/halfResolution;
    vec4 air=texture2D(volume,uv);
    float w=(x==0?1.0-f.x:f.x)*(y==0?1.0-f.y:f.y);
    float delta=abs(air.a-(d>=.999999?log2(321.0):depthLog));
    w*=exp(-delta*32.0)+.0001;
    light+=air.rgb*w;ao+=texture2D(ambientOcclusion,uv).r*w;weight+=w;
  }
  vec3 colour=texture2D(sceneColour,vUv).rgb;
  float visibility=d>=.999999?1.0:mix(1.0,clamp(ao/weight,0.0,1.0),.3);
  // Sky has no surface depth: cloud cover only darkens real geometry.
  float shade=d>=.999999?0.0:cloudOcclusion((cameraWorld*vec4(p,1.0)).xyz);
  // Keep the environment fill readable and gently attenuate scattered sun.
  gl_FragColor=vec4(colour*visibility*(1.0-shade)+light/weight*(1.0-shade*.6),1.0);
}`;

export const temporalFragment=`
varying vec2 vUv;
uniform sampler2D currentColour,historyColour,sceneDepth,motion;
uniform vec2 texel;
uniform mat4 inverseProjection,cameraWorld,previousViewProjection;
uniform float historyReady;
vec3 viewPosition(vec2 uv,float d){vec4 p=inverseProjection*vec4(uv*2.0-1.0,d*2.0-1.0,1.0);return p.xyz/p.w;}
vec3 perceptual(vec3 c){return c/(1.0+max(max(c.r,c.g),c.b));}
vec3 toYCoCg(vec3 c){return vec3(dot(c,vec3(.25,.5,.25)),c.r*.5-c.b*.5,-c.r*.25+c.g*.5-c.b*.25);}
vec3 fromYCoCg(vec3 c){return vec3(c.x+c.y-c.z,c.x+c.z,c.x-c.y-c.z);}
void main(){
  float depth=texture2D(sceneDepth,vUv).r;vec3 position=viewPosition(vUv,depth);
  vec4 velocity=texture2D(motion,vUv);
  float reactive=step(1.01,velocity.w);
  if(reactive<.5)velocity.xyz/=max(velocity.w,.0001);
  vec2 previousUV=vUv-velocity.xy;
  float currentDepth=log2(1.0+max(-position.z,0.0));
  float expectedDepth=velocity.z;
  if(depth>=.999999){
    vec3 worldRay=mat3(cameraWorld)*normalize(position);
    vec4 previous=previousViewProjection*vec4(worldRay,0.0);
    previousUV=previous.xy/max(previous.w,.00001)*.5+.5;expectedDepth=0.0;currentDepth=0.0;velocity.xy=vec2(0.0);
  }
  vec3 low=vec3(1e10),high=vec3(-1e10),mean=vec3(0.0),square=vec3(0.0);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec3 c=toYCoCg(perceptual(texture2D(currentColour,vUv+vec2(float(x),float(y))*texel).rgb));
    low=min(low,c);high=max(high,c);mean+=c;square+=c*c;
  }
  mean/=9.0;vec3 deviation=sqrt(max(vec3(0.0),square/9.0-mean*mean));
  low=max(low,mean-deviation*1.35);high=min(high,mean+deviation*1.35);
  vec4 history=texture2D(historyColour,previousUV);
  vec3 bounded=clamp(toYCoCg(perceptual(history.rgb)),low,high);
  vec3 mapped=max(vec3(0.0),fromYCoCg(bounded));
  vec3 old=mapped/max(.001,1.0-max(max(mapped.r,mapped.g),mapped.b));
  float valid=historyReady;
  if(any(lessThan(previousUV,vec2(0.0)))||any(greaterThan(previousUV,vec2(1.0))))valid=0.0;
  if(abs(history.a-expectedDepth)>.018+.002*expectedDepth)valid=0.0;
  if(reactive>.5)valid=0.0;
  vec3 current=texture2D(currentColour,vUv).rgb;
  float speed=length(velocity.xy/texel);
  float blend=mix(.9,.65,clamp(speed/24.0,0.0,1.0))*valid;
  gl_FragColor=vec4(mix(current,old,blend),currentDepth);
}`;
