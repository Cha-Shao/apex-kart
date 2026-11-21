import * as THREE from 'three';
import {KART_SPEC} from './kart-spec';
import {tyreGeometry} from './surface-materials';
const mat=(color:number,metalness=0,roughness=.65)=>new THREE.MeshStandardMaterial({color,metalness,roughness});
export function makeKart(){
  const root=new THREE.Group();
  const body=new THREE.Group();body.name='kart-body';root.add(body);let parentParts=root;
  const paint=mat(0xc4ed4c,.25,.32),dark=mat(0x192c30,.25,.42),black=mat(0x10191b,.05,.85),metal=mat(0x879a9a,.85,.3),white=mat(0xf0f1e9,.1,.4),suit=mat(0x23454a,.1,.8);
  dark.name='vehicle-carbon';black.name='vehicle-rubber';metal.name='vehicle-alloy';suit.name='vehicle-fabric';
  const part=(geo:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,parent=parentParts)=>{const mesh=new THREE.Mesh(geo,m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,m:THREE.Material,parent=parentParts)=>part(new THREE.BoxGeometry(w,h,d),m,x,y,z,parent);
  const tube=(a:THREE.Vector3,b:THREE.Vector3,r:number,m:THREE.Material,parent=parentParts)=>{const v=b.clone().sub(a);const mesh=part(new THREE.CylinderGeometry(r,r,v.length(),10),m,...a.clone().add(b).multiplyScalar(.5).toArray() as [number,number,number],parent);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());return mesh;};
  parentParts=body;
  // Welded tubular chassis, side pods and front nose.
  box(0,-.09,0,1.15,.14,1.94,dark);
  for(const x of [-.57,.57]){tube(new THREE.Vector3(x,-.02,.9),new THREE.Vector3(x,-.02,-1.0),.045,metal);box(x*1.24,.05,.02,.34,.25,1.21,paint);box(x*1.24,.185,.03,.26,.022,.85,dark);}
  box(0,-.02,-1.05,1.73,.18,.27,paint);box(0,-.035,1.10,1.70,.14,.15,dark);
  const nose=box(0,.12,-.72,.68,.22,.62,paint);nose.rotation.x=-.12;
  box(0,.24,-.74,.16,.018,.42,dark);
  box(0,.02,-.15,.55,.12,.64,metal);
  // Bucket seat, exposed engine, exhaust and rear axle.
  box(0,.16,.30,.55,.18,.58,black);const seat=box(0,.44,.58,.56,.62,.13,black);seat.rotation.x=-.16;
  tube(new THREE.Vector3(-.87,-.02,.79),new THREE.Vector3(.87,-.02,.79),.065,metal);
  box(.48,.22,.70,.38,.37,.43,dark);for(let i=0;i<6;i++)box(.48,.20+i*.041,.70,.40,.018,.45,metal);
  tube(new THREE.Vector3(.58,.31,.87),new THREE.Vector3(.58,.30,1.22),.07,dark);
  part(new THREE.CylinderGeometry(.11,.11,.23,16),black,-.45,.24,.7).rotation.z=Math.PI/2;
  // Driver: legs, torso, articulated arms and a helmet with a dark visor.
  parentParts=root;
  for(const x of [-.16,.16]){const leg=box(x,.20,-.20,.19,.20,.65,suit);leg.rotation.x=.15;box(x,.14,-.60,.20,.13,.24,black);}
  const torso=part(new THREE.CapsuleGeometry(.22,.22,5,10),suit,0,.60,.32);torso.rotation.x=-.18;
  const head=new THREE.Group();head.name='driver-head';head.position.set(0,1.05,.28);root.add(head);
  part(new THREE.SphereGeometry(.265,40,24),white,0,0,0,head);
  // SphereGeometry's phi=3π/2 faces local -Z, the kart's forward direction.
  const visor=part(new THREE.SphereGeometry(.272,32,16,Math.PI*1.12,Math.PI*.76,Math.PI*.32,Math.PI*.32),dark,0,.01,0,head);visor.name='forward-facing-visor';
  box(0,.252,-.01,.065,.016,.22,paint,head);
  const steering=new THREE.Group();steering.name='driver-steering';steering.position.set(0,.60,-.37);steering.rotation.x=-.48;root.add(steering);
  const ring=part(new THREE.TorusGeometry(.22,.027,8,24),black,0,0,0,steering);ring.rotation.x=0;
  for(const a of [0,Math.PI*2/3,Math.PI*4/3]){const spoke=box(Math.sin(a)*.10,Math.cos(a)*.10,0,.025,.22,.025,metal,steering);spoke.rotation.z=-a;}
  tube(new THREE.Vector3(0,.30,-.24),new THREE.Vector3(0,.56,-.34),.035,metal);
  for(const side of [-1,1]){tube(new THREE.Vector3(side*.20,.71,.28),new THREE.Vector3(side*.32,.55,.0),.075,suit);tube(new THREE.Vector3(side*.32,.55,0),new THREE.Vector3(side*.20,.60,-.37),.065,suit);
    // Gloves need to follow the steering wheel, not remain fixed on the
    // chassis while the ring rotates. Local X offsets put them on the rim.
    const glove=part(new THREE.SphereGeometry(.085,16,12),black,side*.20,0,0,steering);glove.name=`steering-glove-${side}`;
  }
  // Number plates generated locally: no remote assets are needed to play.
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#eef0d8';ctx.fillRect(0,0,128,128);ctx.fillStyle='#152629';ctx.font='900 100px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('07',64,70);
  const number=new THREE.CanvasTexture(canvas);number.colorSpace=THREE.SRGBColorSpace;
  const plate=part(new THREE.PlaneGeometry(.40,.32),new THREE.MeshStandardMaterial({map:number,roughness:.5}),0,.28,-.93);plate.rotation.x=-Math.PI/2+.22;
  const rear=part(new THREE.PlaneGeometry(.40,.28),new THREE.MeshStandardMaterial({map:number}),0,.30,1.13);rear.rotation.y=Math.PI;
  const wheelMeshes:THREE.Group[]=[];
  // Fat racing slicks: broad flat tread, naturally rounded shoulders and a
  // softly bulging sidewall. These use their OWN opaque materials: do not
  // name them 'vehicle-tyre', which is replaced by applyVehicleMaterials().
  const tire=mat(0x303136,0,.91),rubberEdge=mat(0x232529,0,.94);
  const goldRim=mat(0xc29a4c,.76,.31);
  const goldDish=mat(0x9d793c,.66,.42);
  const goldHighlight=mat(0xe0bc69,.70,.29);
  tire.name='kart-slick-tread';rubberEdge.name='kart-slick-bead';
  goldRim.name='kart-gold-wheel-rim';goldDish.name='kart-gold-wheel-dish';
  for(const rubber of [tire,rubberEdge]){
    rubber.depthTest=true;rubber.depthWrite=true;rubber.transparent=false;
    rubber.side=THREE.DoubleSide;
  }
  const rimRadius=KART_SPEC.rimRadius;
  // Subtle sidewall lettering inspired by the reference's white racing-tyre
  // markings, but branded APEX rather than copying a real tyre logo.
  const inkCanvas=document.createElement('canvas');
  inkCanvas.width=inkCanvas.height=512;
  const ink=inkCanvas.getContext('2d')!;
  ink.fillStyle='rgba(239,237,222,.87)';
  ink.font='900 48px Arial';ink.textAlign='center';ink.textBaseline='middle';
  const arcText=(label:string,centerAngle:number,flip:boolean)=>{
    for(let k=0;k<label.length;k++){
      const angle=centerAngle+(k-(label.length-1)*.5)*.19;
      ink.save();
      ink.translate(256+211*Math.cos(angle),256+211*Math.sin(angle));
      ink.rotate(angle+(flip?-Math.PI/2:Math.PI/2));
      ink.fillText(label[k],0,0);
      ink.restore();
    }
  };
  arcText('APEX',-Math.PI/2,false);
  arcText('SLICK',Math.PI/2,true);
  const inkTexture=new THREE.CanvasTexture(inkCanvas);
  inkTexture.colorSpace=THREE.SRGBColorSpace;
  const inkMaterial=new THREE.MeshBasicMaterial({
    name:'kart-sidewall-racing-letters',map:inkTexture,
    transparent:true,depthWrite:false,alphaTest:.12,
    side:THREE.DoubleSide,toneMapped:false,
  });
  // Measured 10x4.50-5 front and 11x7.10-5 rear tyres. Visual size, five-inch
  // rim openings and physics radii now match; no exaggerated scale offsets.
  for(let i=0;i<4;i++){
    const wheel=new THREE.Group();wheel.name='kart-slick-wheel-'+i;
    const front=i<2;
    const tyreRadius=front?KART_SPEC.frontWheelRadius:KART_SPEC.rearWheelRadius;
    const width=front?KART_SPEC.frontTyreWidth:KART_SPEC.rearTyreWidth;
    const tyre=new THREE.Mesh(tyreGeometry(tyreRadius,width,rimRadius),tire);
    tyre.name='rounded-slick-tyre';tyre.castShadow=true;tyre.receiveShadow=true;
    wheel.add(tyre);

    // A recessed opaque core prevents an open annulus from ever looking like
    // a missing tyre if the camera peers through the inner rim at an angle.
    const core=new THREE.Mesh(new THREE.CylinderGeometry(rimRadius*.94,rimRadius*.94,width*.76,36),rubberEdge);
    core.name='slick-tyre-inner-core';core.rotation.z=Math.PI/2;
    core.castShadow=true;core.receiveShadow=true;wheel.add(core);

    for(const side of [-1,1]){
      // Thick rubber bead around the small opening, not a torus around the
      // entire tyre shoulder (which produced the old fake tube shape).
      const bead=new THREE.Mesh(new THREE.TorusGeometry(rimRadius*1.025,rimRadius*.065,10,48),rubberEdge);
      bead.rotation.y=side*Math.PI/2;bead.position.x=side*(width*.5-.001);
      wheel.add(bead);

      // The reference has a gold deep-dish wheel with an inset face, raised
      // outer lip and a little metallic edge highlight, not a flat grey cap.
      const dish=new THREE.Mesh(new THREE.CylinderGeometry(rimRadius*.88,rimRadius*.88,.012,48),goldDish);
      dish.name='recessed-gold-wheel-face';dish.rotation.z=Math.PI/2;
      dish.position.x=side*(width*.5-.008);
      dish.castShadow=true;dish.receiveShadow=true;wheel.add(dish);

      const rim=new THREE.Mesh(new THREE.TorusGeometry(rimRadius*.925,rimRadius*.074,12,56),goldRim);
      rim.name='gold-rim-outer-lip';rim.rotation.y=side*Math.PI/2;
      rim.position.x=side*(width*.5+.005);
      rim.castShadow=true;rim.receiveShadow=true;wheel.add(rim);

      const innerLip=new THREE.Mesh(new THREE.TorusGeometry(rimRadius*.71,rimRadius*.035,10,48),goldHighlight);
      innerLip.rotation.y=side*Math.PI/2;innerLip.position.x=side*(width*.5-.002);
      wheel.add(innerLip);

      const hub=new THREE.Mesh(new THREE.CylinderGeometry(tyreRadius*.11,tyreRadius*.11,.025,24),metal);
      hub.name='kart-axle-nut';hub.rotation.z=Math.PI/2;
      hub.position.x=side*(width*.5+.003);
      hub.castShadow=true;wheel.add(hub);

      const sidewallInk=new THREE.Mesh(new THREE.PlaneGeometry(tyreRadius*2.05,tyreRadius*2.05),inkMaterial);
      sidewallInk.name='apex-slick-sidewall-lettering';
      sidewallInk.rotation.y=side*Math.PI/2;
      sidewallInk.position.x=side*(width*.5+.007);
      sidewallInk.renderOrder=1;sidewallInk.castShadow=false;
      wheel.add(sidewallInk);
    }
    // Preserve the independent world-space Cannon transform and steering.
    // Double the previous rendered tyre dimensions along with the body.
    // These groups are independent scene roots: only the visuals grow;
    // raycast wheel radii and the vehicle collision remain unchanged.
    const wrapper=new THREE.Group();wrapper.add(wheel);
    wrapper.scale.setScalar(KART_SPEC.wheelVisualScale);
    wheelMeshes.push(wrapper);
  }
  root.scale.set(KART_SPEC.artScale.x*KART_SPEC.visualScale,
    KART_SPEC.artScale.y*KART_SPEC.visualScale,
    KART_SPEC.artScale.z*KART_SPEC.visualScale);
  return {root,wheelMeshes,paint,steering,head,body};
}
