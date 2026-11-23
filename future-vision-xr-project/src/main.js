import * as THREE from 'three';
import { FilesetResolver, HandLandmarker, FaceLandmarker } from '@mediapipe/tasks-vision';

const $ = (s) => document.querySelector(s);
const homeScreen = $('#homeScreen'), howScreen = $('#howScreen'), labScreen = $('#labScreen');
const video = $('#cameraVideo'), threeCanvas = $('#threeCanvas'), faceCanvas = $('#faceCanvas');
const cameraMessage = $('#cameraMessage'), cameraLabel = $('#cameraLabel'), gestureHint = $('#gestureHint');
const toastEl = $('#toast');

let stream = null, cameraFacing = 'environment', currentMode = 'hologram', currentObject = 'robot';
let handLandmarker = null, faceLandmarker = null, gestureOn = false, lastDetect = 0, lastFaceDetect = 0;
let selectedEffect = 'visor', soundOn = false, handWasPinching = false, grabbed = false;
let handTarget = new THREE.Vector3(0, 0, 0), isDragging = false, lastPinch = 0;
let scene, camera, renderer, activeGroup, animationId, autoRotate = true;
const clock = new THREE.Clock();

function toast(message) {
  toastEl.textContent = message; toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2600);
}
function showScreen(screen) {
  [homeScreen, howScreen, labScreen].forEach(s => s.classList.add('hidden'));
  screen.classList.remove('hidden');
}
$('#startBtn').addEventListener('click', () => { showScreen(labScreen); startCamera(); });
$('#howBtn').addEventListener('click', () => showScreen(howScreen));
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => showScreen(homeScreen)));
$('#exitBtn').addEventListener('click', stopExperience);
$('#cameraStartBtn').addEventListener('click', startCamera);
$('#switchCameraBtn').addEventListener('click', async () => {
  cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment';
  await startCamera();
});
$('#fullscreenBtn').addEventListener('click', async () => {
  try { if (!document.fullscreenElement) await $('#cameraStage').requestFullscreen(); else await document.exitFullscreen(); }
  catch { toast('Fullscreen is not available in this browser.'); }
});
$('#soundBtn').addEventListener('click', () => { soundOn = !soundOn; $('#soundBtn').style.color = soundOn ? '#53d9ff' : ''; toast(soundOn ? 'Sound effects enabled' : 'Sound effects muted'); });
$('#rotateBtn').addEventListener('click', () => { autoRotate = !autoRotate; toast(autoRotate ? 'Auto rotation enabled' : 'Auto rotation paused'); });
$('#resetBtn').addEventListener('click', () => { if (activeGroup) { activeGroup.position.set(0,0,0); activeGroup.rotation.set(0,0,0); activeGroup.scale.setScalar(1); $('#scaleSlider').value = 100; $('#scaleValue').textContent = '100%'; } });
$('#scaleSlider').addEventListener('input', e => {
  const v = Number(e.target.value); $('#scaleValue').textContent = `${v}%`;
  if (activeGroup) activeGroup.scale.setScalar(v / 100);
});
document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
document.querySelectorAll('[data-object]').forEach(btn => btn.addEventListener('click', () => selectObject(btn.dataset.object)));
document.querySelectorAll('[data-effect]').forEach(btn => btn.addEventListener('click', () => {
  selectedEffect = btn.dataset.effect;
  document.querySelectorAll('[data-effect]').forEach(b => b.classList.toggle('active', b === btn));
  toast(selectedEffect === 'none' ? 'Effects cleared' : `${btn.textContent.trim()} selected`);
}));
$('#gestureBtn').addEventListener('click', enableGestures);
$('#cityBtn').addEventListener('click', () => selectObject('city'));
$('#carBtn').addEventListener('click', () => selectObject('car'));

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('#hologramControls').classList.toggle('hidden', mode !== 'hologram');
  $('#mirrorControls').classList.toggle('hidden', mode !== 'mirror');
  $('#stageControls').classList.toggle('hidden', mode !== 'stage');
  $('#modeTitle').textContent = mode === 'mirror' ? 'FUTURE YOU / AR MIRROR' : mode === 'stage' ? 'THE WORLD OF 2050' : 'HOLOGRAM LAB';
  if (mode === 'mirror') {
    cameraFacing = 'user'; startCamera();
    gestureHint.textContent = 'Look at the camera and try a future filter';
  } else {
    cameraFacing = 'environment'; startCamera();
    gestureHint.textContent = 'Show one hand to the camera to interact';
  }
}
function stopExperience() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; video.srcObject = null; gestureOn = false;
  $('#gestureStatus').textContent = 'OFF'; $('#gestureBtn').textContent = 'ENABLE HAND CONTROL';
  cameraMessage.classList.remove('hidden'); cameraLabel.textContent = 'CAMERA STANDBY';
  showScreen(homeScreen);
}
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { toast('Camera requires HTTPS and a modern browser.'); return; }
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: cameraFacing }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    video.style.transform = cameraFacing === 'user' ? 'scaleX(-1)' : 'none';
    await video.play();
    cameraMessage.classList.add('hidden'); cameraLabel.textContent = cameraFacing === 'user' ? 'FRONT CAMERA ACTIVE' : 'REAR CAMERA ACTIVE';
    initThree();
    toast('Camera activated. Welcome to Future Vision XR.');
    if (currentMode === 'mirror') loadFaceModel();
  } catch (err) {
    console.error(err);
    cameraMessage.classList.remove('hidden');
    toast(err.name === 'NotAllowedError' ? 'Please allow camera access in your browser settings.' : 'Could not start camera. Check permissions and try again.');
  }
}

function initThree() {
  if (renderer) { renderer.dispose(); }
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 7);
  renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(threeCanvas.clientWidth || 800, threeCanvas.clientHeight || 500, false);
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const key = new THREE.PointLight(0x64ddff, 45, 30); key.position.set(3, 4, 6); scene.add(key);
  const fill = new THREE.PointLight(0x256dff, 22, 30); fill.position.set(-4, -2, 4); scene.add(fill);
  activeGroup = new THREE.Group(); scene.add(activeGroup);
  buildObject(currentObject);
  window.addEventListener('resize', resizeThree);
  if (!animationId) animate();
}
function resizeThree() {
  if (!renderer || !camera) return;
  const w = threeCanvas.clientWidth || 800, h = threeCanvas.clientHeight || 500;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
function mat(color, metalness=0.35, roughness=0.28, emissive=0x071b2a) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: 0.45 });
}
function addMesh(parent, geometry, material, x=0,y=0,z=0) {
  const m = new THREE.Mesh(geometry, material); m.position.set(x,y,z); parent.add(m); return m;
}
function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.traverse?.(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose()); } });
  }
}
function buildObject(type) {
  if (!activeGroup) return;
  clearGroup(activeGroup); currentObject = type;
  const cyan = mat(0x54dfff,0.75,0.2,0x0c83ad), dark = mat(0x1c3449,0.8,0.25,0x06243b);
  const white = mat(0xc9eaff,0.35,0.3,0x173c55), gold = mat(0xffbd63,0.65,0.25,0x59300b);
  const black = mat(0x08111c,0.4,0.35,0x02070c);
  const sphere = (p,x,y,z,sx,sy,sz,material) => { const o=addMesh(p,new THREE.SphereGeometry(1,32,24),material,x,y,z); o.scale.set(sx,sy,sz); return o; };
  const box = (p,x,y,z,sx,sy,sz,material,r=.08) => { const o=addMesh(p,new THREE.BoxGeometry(sx,sy,sz),material,x,y,z); return o; };
  if (type === 'robot') {
    sphere(activeGroup,0,0.9,0,.52,.58,.42,white);
    box(activeGroup,0,0.05,0,.9,1.05,.52,dark);
    sphere(activeGroup,0,.98,.38,.36,.18,.08,cyan);
    sphere(activeGroup,-.15,.98,.45,.055,.055,.035,white); sphere(activeGroup,.15,.98,.45,.055,.055,.035,white);
    for (const side of [-1,1]) {
      const arm=box(activeGroup,side*.68,.08,0,.22,.85,.25,white); arm.rotation.z=side*.13;
      sphere(activeGroup,side*.7,-.43,0,.17,.17,.17,cyan);
      box(activeGroup,side*.25,-.78,0,.25,.65,.3,dark);
      sphere(activeGroup,side*.25,-1.13,.02,.24,.13,.34,white);
      sphere(activeGroup,side*.48,.7,0,.13,.13,.13,gold);
    }
    box(activeGroup,0,-.08,.29,.42,.12,.04,cyan);
  } else if (type === 'brain') {
    const brain = new THREE.Group(); activeGroup.add(brain);
    for (let i=0;i<17;i++) {
      const a=(i/17)*Math.PI*2, y=Math.sin(i*2.1)*.32, r=.57+Math.cos(i*1.7)*.06;
      sphere(brain,Math.cos(a)*r*.7,y,Math.sin(a)*r*.48,.25,.24,.23,i%3===0?white:cyan);
    }
    const core=sphere(activeGroup,0,0,0,.16,.16,.16,gold);
    for(let i=0;i<3;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(.9+i*.16,.012,8,100),cyan);ring.rotation.x=Math.PI/2+i*.4;activeGroup.add(ring);}
  } else if (type === 'car') {
    const body=box(activeGroup,0,-.12,0,2.15,.48,.95,cyan); body.scale.y=.8;
    const cabin=box(activeGroup,-.05,.28,0,1.15,.48,.78,white);
    for(const x of [-.68,.68]) for(const z of [-.51,.51]) {
      const wheel=addMesh(activeGroup,new THREE.CylinderGeometry(.23,.23,.13,32),black,x,-.43,z); wheel.rotation.x=Math.PI/2;
      const hub=addMesh(activeGroup,new THREE.CylinderGeometry(.1,.1,.14,24),gold,x,-.43,z); hub.rotation.x=Math.PI/2;
    }
    box(activeGroup,1.05,-.1,0,.08,.16,.7,gold);
  } else if (type === 'phone') {
    const device=box(activeGroup,0,0,0,1.1,1.9,.12,dark); device.material=dark;
    const screen=box(activeGroup,0,0,.071,.96,1.72,.015,cyan);
    const glass=box(activeGroup,0,0,.083,.86,1.55,.008,black);
    for(let i=0;i<5;i++){const line=box(activeGroup,0,.45-i*.2,.095,.65,.025,.012,i===0?gold:cyan);}
    sphere(activeGroup,0,-.82,.1,.06,.06,.025,white);
  } else if (type === 'satellite') {
    box(activeGroup,0,0,0,.65,.65,.65,white);
    for(const side of [-1,1]) {
      const panel=box(activeGroup,side*.95,0,0,1.1,.65,.07,cyan);
      for(let i=0;i<4;i++) box(activeGroup,side*(.55+i*.25),0,.045,.02,.58,.01,dark);
      const rod=box(activeGroup,side*.43,.52,0,.04,.65,.04,gold); rod.rotation.z=side*.35;
    }
    const dish=addMesh(activeGroup,new THREE.ConeGeometry(.42,.35,32),white,0,.58,0); dish.rotation.x=Math.PI;
  } else if (type === 'city') {
    const ground=addMesh(activeGroup,new THREE.CylinderGeometry(1.75,1.75,.08,64),dark,0,-.9,0);
    for(let i=0;i<12;i++){
      const a=i/12*Math.PI*2, h=.55+(i%4)*.28, r=.95+(i%3)*.35;
      const b=box(activeGroup,Math.cos(a)*r,-.9+h/2,Math.sin(a)*r,.28,h,.28,i%3===0?gold:cyan);
      for(let j=0;j<3;j++) box(activeGroup,b.position.x,-.9+h*.25+j*.17,b.position.z+.146,.12,.035,.012,white);
    }
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.9,.018,8,100),cyan);ring.rotation.x=Math.PI/2;ring.position.y=-.82;activeGroup.add(ring);
  }
  // Ground halo and floating data particles
  const halo = new THREE.Mesh(new THREE.TorusGeometry(type==='city'?1.85:1.15,.012,8,100), new THREE.MeshBasicMaterial({color:0x53d9ff,transparent:true,opacity:.7}));
  halo.rotation.x=Math.PI/2; halo.position.y=-1.25; activeGroup.add(halo);
  for(let i=0;i<12;i++){const p=sphere(activeGroup,Math.sin(i*9)*1.4,Math.cos(i*4)*1.4,Math.cos(i*7)*.6,.018,.018,.018,cyan);}
  activeGroup.scale.setScalar(Number($('#scaleSlider').value)/100);
  document.querySelectorAll('[data-object]').forEach(b=>b.classList.toggle('selected',b.dataset.object===type));
  $('#tipText').textContent = `${type.toUpperCase()} selected. Drag with your finger or try hand gestures.`;
}
function selectObject(type) { buildObject(type); if(currentMode==='stage') setMode('stage'); toast(`${type.toUpperCase()} hologram loaded`); }

function animate() {
  animationId = requestAnimationFrame(animate);
  if (!renderer || !scene || !camera) return;
  const t = clock.getElapsedTime();
  if (activeGroup) {
    if (autoRotate && !grabbed) activeGroup.rotation.y += 0.004;
    activeGroup.position.y = Math.sin(t*1.1)*.07;
    if (grabbed) {
      activeGroup.position.x += (handTarget.x-activeGroup.position.x)*.18;
      activeGroup.position.y += (handTarget.y-activeGroup.position.y)*.18;
    }
  }
  renderer.render(scene,camera);
  if (video.readyState >= 2 && gestureOn && performance.now()-lastDetect>75) detectHands();
  if (video.readyState >= 2 && currentMode==='mirror' && performance.now()-lastFaceDetect>90) detectFace();
}
function screenToWorld(x,y) {
  const rect=threeCanvas.getBoundingClientRect();
  const nx=((x-rect.left)/rect.width)*2-1, ny=-((y-rect.top)/rect.height)*2+1;
  const v=new THREE.Vector3(nx,ny,.5).unproject(camera);
  const dir=v.sub(camera.position).normalize();
  return camera.position.clone().add(dir.multiplyScalar((0-camera.position.z)/dir.z));
}
threeCanvas.addEventListener('pointerdown', e => {
  if (!activeGroup || currentMode==='mirror') return;
  grabbed=true; const p=screenToWorld(e.clientX,e.clientY); handTarget.set(p.x,p.y,0);
});
threeCanvas.addEventListener('pointermove', e => { if(grabbed){const p=screenToWorld(e.clientX,e.clientY);handTarget.set(p.x,p.y,0);} });
window.addEventListener('pointerup',()=>{grabbed=false;});
function normalizedToWorld(x,y) {
  const rect=threeCanvas.getBoundingClientRect();
  const px=rect.left+(1-x)*rect.width, py=rect.top+y*rect.height;
  return screenToWorld(px,py);
}
async function enableGestures() {
  if (!stream || cameraFacing !== 'environment') { toast('Switch to the rear camera first.'); return; }
  try {
    if (!handLandmarker) {
      toast('Loading hand tracking AI…');
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
      const handOptions = {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: 'GPU' },
        runningMode: 'VIDEO', numHands: 1
      };
      try { handLandmarker = await HandLandmarker.createFromOptions(vision, handOptions); }
      catch { handOptions.baseOptions.delegate = 'CPU'; handLandmarker = await HandLandmarker.createFromOptions(vision, handOptions); }
    }
    gestureOn = !gestureOn;
    $('#gestureStatus').textContent = gestureOn ? 'ON' : 'OFF';
    $('#gestureStatus').style.color = gestureOn ? '#59ffc0' : '#ffbd62';
    $('#gestureBtn').textContent = gestureOn ? 'DISABLE HAND CONTROL' : 'ENABLE HAND CONTROL';
    $('#gestureDescription').textContent = gestureOn ? 'Pinch your thumb and index finger to grab. Move your hand to move the hologram. Open your hand to release.' : 'Enable gesture control to move the hologram without touching the screen.';
    toast(gestureOn ? 'Hand tracking enabled. Show your hand!' : 'Hand tracking disabled.');
  } catch (err) {
    console.error(err); toast('Hand tracking could not load. Use touch controls instead.');
  }
}
function detectHands() {
  lastDetect = performance.now();
  try {
    const result = handLandmarker.detectForVideo(video, lastDetect);
    const landmarks = result.landmarks?.[0];
    if (!landmarks) { grabbed=false; gestureHint.textContent='Show one hand to the camera'; return; }
    const thumb=landmarks[4], index=landmarks[8], wrist=landmarks[0];
    const distance=Math.hypot(thumb.x-index.x,thumb.y-index.y);
    const pinch=distance<.065;
    const point=normalizedToWorld(index.x,index.y);
    handTarget.set(point.x,point.y,0);
    if (pinch && !handWasPinching) { grabbed=true; gestureHint.textContent='PINCH DETECTED · OBJECT GRABBED'; }
    if (!pinch && handWasPinching) { grabbed=false; gestureHint.textContent='OBJECT RELEASED · PINCH TO GRAB'; }
    if (pinch) gestureHint.textContent='MOVE YOUR HAND TO MOVE THE HOLOGRAM';
    handWasPinching=pinch;
  } catch(err) { console.warn('Hand tracking frame failed',err); }
}
async function loadFaceModel() {
  try {
    if (!faceLandmarker) {
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
      const faceOptions = {
        baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',delegate:'GPU'},
        runningMode:'VIDEO',numFaces:1
      };
      try { faceLandmarker = await FaceLandmarker.createFromOptions(vision, faceOptions); }
      catch { faceOptions.baseOptions.delegate = 'CPU'; faceLandmarker = await FaceLandmarker.createFromOptions(vision, faceOptions); }
    }
    toast('Face tracking ready. Look at the camera.');
  } catch(err) { console.error(err); toast('Face tracking unavailable. Check your connection.'); }
}
function detectFace() {
  lastFaceDetect=performance.now();
  if(!faceLandmarker) return;
  const ctx=faceCanvas.getContext('2d');
  const w=faceCanvas.clientWidth,h=faceCanvas.clientHeight;
  if(faceCanvas.width!==w*devicePixelRatio||faceCanvas.height!==h*devicePixelRatio){faceCanvas.width=w*devicePixelRatio;faceCanvas.height=h*devicePixelRatio;}
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);ctx.clearRect(0,0,w,h);
  try{
    const res=faceLandmarker.detectForVideo(video,lastFaceDetect);
    const pts=res.faceLandmarks?.[0]; if(!pts)return;
    const x=p=>(1-p.x)*w, y=p=>p.y*h;
    ctx.strokeStyle='#63e8ff';ctx.fillStyle='#63e8ff';ctx.lineWidth=2.2;ctx.shadowColor='#39dfff';ctx.shadowBlur=14;
    const left=pts[33],right=pts[263],nose=pts[1],forehead=pts[10],chin=pts[152];
    const eyeY=(y(pts[159])+y(pts[386]))/2;
    const centerX=(x(left)+x(right))/2;
    if(selectedEffect==='visor'){
      ctx.beginPath();ctx.moveTo(x(left)-17,eyeY-7);ctx.lineTo(x(right)+17,eyeY-7);ctx.lineTo(x(right)+8,eyeY+25);ctx.lineTo(centerX,eyeY+34);ctx.lineTo(x(left)-8,eyeY+25);ctx.closePath();
      const grad=ctx.createLinearGradient(0,eyeY,0,eyeY+40);grad.addColorStop(0,'rgba(50,220,255,.65)');grad.addColorStop(1,'rgba(15,70,140,.25)');ctx.fillStyle=grad;ctx.fill();ctx.stroke();
      ctx.fillStyle='#dfffff';ctx.font='10px monospace';ctx.fillText('CYBER VISOR',centerX-38,eyeY-14);
    } else if(selectedEffect==='glasses'){
      ctx.beginPath();ctx.ellipse(x(pts[33]),eyeY,23,14,0,0,Math.PI*2);ctx.ellipse(x(pts[263]),eyeY,23,14,0,0,Math.PI*2);ctx.moveTo(x(pts[33])+23,eyeY);ctx.lineTo(x(pts[263])-23,eyeY);ctx.stroke();
    } else if(selectedEffect==='crown'){
      ctx.beginPath();ctx.moveTo(x(forehead)-50,y(forehead)+25);ctx.lineTo(x(forehead)-35,y(forehead)-25);ctx.lineTo(centerX-12,y(forehead)+5);ctx.lineTo(centerX,y(forehead)-42);ctx.lineTo(centerX+15,y(forehead)+5);ctx.lineTo(x(forehead)+45,y(forehead)-25);ctx.lineTo(x(forehead)+55,y(forehead)+25);ctx.closePath();ctx.stroke();
    } else if(selectedEffect==='scan'){
      ctx.beginPath();ctx.ellipse(centerX,(y(forehead)+y(chin))/2,Math.abs(x(left)-x(right))*.75,Math.abs(y(chin)-y(forehead))*.7,0,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#8ff4ff';ctx.font='10px monospace';ctx.fillText('BIOMETRIC SCAN / ACTIVE',centerX-70,y(chin)+18);
    }
  }catch(err){console.warn('Face tracking frame failed',err);}
}
