// Shared metre-based dimensions for the procedural model, wheels and rigid body.
export const KART_SPEC={
  artScale:{x:.667,y:.72,z:.75},
  wheelRadius:.14,
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
  rideHeight:.14+.105-9.81/(4*55)+.04,
};

