// After opaque barriers/vehicles (0) and paved surfaces (10–60). Their depth
// can reject hidden foliage fragments before expensive leaf lighting runs.
// Keep foliage opaque, depth-tested and depth-writing; transparent smoke and
// water retain the renderer's later passes. This is not back-face culling.
export const VEGETATION_RENDER_ORDER=80;
