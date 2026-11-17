/** Shared linear-light albedo grade for turf, grass and leaves. Preserve
 * photographic detail and dry stems while bringing living greens together. */
export const vegetationPaletteGLSL=`
vec3 vegetationAlbedo(vec3 source,float gain){
  float luminance=dot(source,vec3(.2126,.7152,.0722));
  vec3 chroma=source/max(luminance,.0001);
  vec3 green=vec3(.78,1.0,.70);
  green/=dot(green,vec3(.2126,.7152,.0722));
  float living=smoothstep(.78,1.18,source.g/max(source.r,.0001));
  vec3 balanced=mix(chroma,green,.3+.42*living);
  balanced=mix(balanced,vec3(1.0),.12);
  return max(vec3(0.0),balanced*luminance*gain);
}
`;

/** Turf and upright grass share one linear-light palette and world-space
 * colour field. Source luminance supplies detail, without retaining the
 * photographed grass atlas's bright straw-yellow stems. */
export const grassPaletteGLSL=`
float grassPaletteNoise(vec2 world){
  vec2 cell=floor(world),t=fract(world);t=t*t*(3.0-2.0*t);
  vec4 dots=vec4(dot(cell,vec2(127.1,311.7)),dot(cell+vec2(1.0,0.0),vec2(127.1,311.7)),dot(cell+vec2(0.0,1.0),vec2(127.1,311.7)),dot(cell+vec2(1.0),vec2(127.1,311.7)));
  vec4 values=fract(sin(dots)*43758.5453);
  return mix(mix(values.x,values.y,t.x),mix(values.z,values.w,t.x),t.y);
}
vec3 grassAlbedo(vec3 source,vec2 world,float sourceLuminance){
  float luminance=dot(source,vec3(.2126,.7152,.0722));
  float detail=clamp(1.0+(luminance/sourceLuminance-1.0)*.55,.65,1.3);
  float grassTone=grassPaletteNoise(world*.045+vec2(19.3,-7.1))*.7+grassPaletteNoise(world*.12+vec2(-3.9,31.7))*.3;
  vec3 green=mix(vec3(.046,.064,.035),vec3(.05,.067,.039),grassTone);
  return green*detail;
}
`;
