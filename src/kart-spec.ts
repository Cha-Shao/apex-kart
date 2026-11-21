// Shared metre-based dimensions for the procedural model, wheels and rigid body.
export const KART_SPEC={
  artScale:{x:.667,y:.72,z:.75},
  // Double the previously half-sized body/driver back to 100% of the
  // original chassis, while doubling the previously unscaled visual tyres.
  // This affects visuals only; Cannon suspension and collision are unchanged.
  visualScale:1,
  wheelVisualScale:2,
  // Real kart slick sizes, in metres (1 inch = .0254m):
  // front 10x4.50-5, rear 11x7.10-5. Last number is rim diameter.
  frontWheelRadius:10*.0254/2,
  rearWheelRadius:11*.0254/2,
  wheelRadius:11*.0254/2, // fallback / driven rear axle
  frontTyreWidth:4.5*.0254,
  rearTyreWidth:7.1*.0254,
  rimRadius:5*.0254/2,
  suspensionRestLength:.105,
  suspensionTravel:.075,
  suspensionStiffness:55,
  connectionY:-.04,
  visualOffset:-.04,
  frontHalfTrack:.81*.667,
  rearHalfTrack:.84*.667,
  frontZ:-.83*.75,
  rearZ:.79*.75,
  wheelbase:1.62*.75,
  // Static spring compression under a quarter of the vehicle's weight.
  rideHeight:11*.0254/2+.105-9.81/(4*55)+.04,
};

