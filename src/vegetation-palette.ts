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

/** Turf and textured grass share a linear-light grey-olive palette.
 * Grass tufts use the original grass_0..3 images as dark luminance masks;
 * their leaf-to-leaf value differences remain visible after tinting. */
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
  // Muted grey-olive green, centred on sRGB #4A5641 (in linear light).
  vec3 green=mix(vec3(.062,.085,.048),vec3(.073,.097,.058),grassTone);
  return green*detail;
}
// The original grass_N PNG is deliberately treated as a DARK VALUE MAP.
// Keep its actual luminance variation, then apply the same muted olive hue.
// Reference value ~0.105 linear matches the ~93 sRGB source grass pixels.
vec3 grassTextureAlbedo(vec3 source,vec2 world){
  float luminance=dot(source,vec3(.2126,.7152,.0722));
  float brightness=clamp(luminance/.105,.24,1.75);
  float grassTone=grassPaletteNoise(world*.045+vec2(19.3,-7.1))*.7+grassPaletteNoise(world*.12+vec2(-3.9,31.7))*.3;
  vec3 green=mix(vec3(.062,.085,.048),vec3(.073,.097,.058),grassTone);
  return green*brightness;
}
`;
