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
