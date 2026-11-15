import {KART_SPEC} from './kart-spec';
export type VehicleId='kart'|'rb20';
export interface VehicleProfile {
 id:VehicleId;name:string;mass:number;width:number;length:number;number:string;
 wheelRadius:number;frontTyreWidth:number;rearTyreWidth:number;frontHalfTrack:number;rearHalfTrack:number;frontZ:number;rearZ:number;wheelbase:number;
 connectionY:number;visualOffset:number;suspensionRestLength:number;suspensionStiffness:number;suspensionTravel:number;rideHeight:number;
 chassisHalf:[number,number,number];chassisOffset:number;chassisBevel?:[length:number,lift:number];
 driveForce:number;powerWatts:number;topSpeed:number;drag:number;rollingResistance:number;downforce:number;grip:number;brakeG:number;
 idleRPM:number;maxRPM:number;steeringRatio:number;cockpitEye:[number,number,number];cockpitGaze:[number,number,number];cockpitFov:number;chase:[number,number,number];
}
export const VEHICLES:Record<VehicleId,VehicleProfile>={
 kart:{id:'kart',name:'APX–07',mass:165,width:1.35,length:1.80,number:'07',...KART_SPEC,
 frontTyreWidth:.23*KART_SPEC.artScale.x,rearTyreWidth:.29*KART_SPEC.artScale.x,
 chassisHalf:[.70*KART_SPEC.artScale.x,.16*KART_SPEC.artScale.y,1.08*KART_SPEC.artScale.z],chassisOffset:KART_SPEC.visualOffset+.02*KART_SPEC.artScale.y,
 driveForce:1120,powerWatts:0,topSpeed:27,drag:.46,rollingResistance:19,downforce:0,grip:2.15,brakeG:1.45,
 idleRPM:1500,maxRPM:4800,steeringRatio:1.8,cockpitEye:[0,.80,.20],cockpitGaze:[0,.80-12*.32,.20-12],cockpitFov:82,chase:[0,4.2,7.4]},
 // Public identity/power-unit specifications and 2024 regulatory minimum mass.
 // Dimensions, aero coefficients and tyre/suspension tuning are game approximations.
 rb20:{id:'rb20',name:'RED BULL RB20',mass:798,width:2,length:5.6,number:'01',
 wheelRadius:.36,frontTyreWidth:.305,rearTyreWidth:.405,frontHalfTrack:.84,rearHalfTrack:.79,frontZ:-1.83,rearZ:1.77,wheelbase:3.6,
 // Leave compression reserve for aero load and uphill transitions. The rigid
 // floor stays between the axles and rises at both ends instead of digging in.
 connectionY:.13,visualOffset:-.10,suspensionRestLength:.12,suspensionStiffness:220,suspensionTravel:.10,rideHeight:.36+.12-9.81/(4*220)-.13,
 chassisHalf:[.43,.12,1.72],chassisOffset:-.02,chassisBevel:[.62,.18],
 driveForce:17000,powerWatts:(900+160)*745.7*.91,topSpeed:105,drag:.86,rollingResistance:115,downforce:3.2,grip:1.90,brakeG:2.4,
 idleRPM:3500,maxRPM:15000,steeringRatio:2.25,cockpitEye:[0,.64,.48],cockpitGaze:[0,.64-12*.115,.48-12],cockpitFov:80,chase:[0,3.1,8.4]},
};
