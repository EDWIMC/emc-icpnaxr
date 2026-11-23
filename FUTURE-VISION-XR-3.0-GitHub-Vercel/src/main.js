import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import QRCode from 'qrcode';
import { FilesetResolver, HandLandmarker, FaceLandmarker } from '@mediapipe/tasks-vision';
import { collaborationConfigured, createRoom as createSharedRoom, joinRoom as joinSharedRoom, leaveRoom as leaveSharedRoom, onRoomEvent, loadRoomState, publishRoomState, getActiveRoom } from './collaboration.js';

// Zappar's standalone Three.js wrapper expects a global THREE namespace.
window.THREE = THREE;
let zapparSdkPromise = null;

function ensureZapparSdk() {
  if (window.ZapparThree) return Promise.resolve(window.ZapparThree);
  if (zapparSdkPromise) return zapparSdkPromise;
  zapparSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://libs.zappar.com/zappar-threejs/4.3.0/zappar-threejs.js';
    script.async = true;
    script.onload = () => window.ZapparThree
      ? resolve(window.ZapparThree)
      : reject(new Error('Zappar SDK loaded without its browser API.'));
    script.onerror = () => reject(new Error('Could not download the Zappar SDK.'));
    document.head.append(script);
  });
  return zapparSdkPromise;
}

const zapparSdkPreload = ensureZapparSdk().catch((error) => { console.warn('Zappar SDK preload failed:', error); return null; });

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
let zapparCamera = null, worldTracker = null, worldAnchorGroup = null;
let worldArSession = null, worldArHitTestSource = null, worldArLocalSpace = null, worldArReticle = null, worldARMode = null;
let worldARActive = false, worldARPlaced = false;
let activeModelLoadToken = 0, roomPublishTimer = null, applyingRemoteState = false;
const gltfLoader = new GLTFLoader();
const optionalModelFiles = {
  robot: 'robot.glb', brain: 'brain.glb', car: 'future-car.glb',
  phone: 'smartphone.glb', satellite: 'satellite.glb', city: 'smart-city.glb'
};
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
$('#worldArBtn').addEventListener('click', startWorldAR);
$('#placeWorldObjectBtn').addEventListener('click', toggleWorldPlacement);
$('#stopWorldArBtn').addEventListener('click', () => stopWorldAR());
$('#createRoomBtn').addEventListener('click', handleCreateRoom);
$('#joinRoomBtn').addEventListener('click', handleJoinRoom);
$('#leaveRoomBtn').addEventListener('click', handleLeaveRoom);
$('#copyRoomLinkBtn').addEventListener('click', copyRoomInvite);
$('#roomCodeInput').addEventListener('input', (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
});
$('#switchCameraBtn').addEventListener('click', async () => {
  if (worldARActive) await stopWorldAR({ silent: true });
  cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment';
  await startCamera();
});
$('#fullscreenBtn').addEventListener('click', async () => {
  try { if (!document.fullscreenElement) await $('#cameraStage').requestFullscreen(); else await document.exitFullscreen(); }
  catch { toast('Fullscreen is not available in this browser.'); }
});
$('#soundBtn').addEventListener('click', () => { soundOn = !soundOn; $('#soundBtn').style.color = soundOn ? '#53d9ff' : ''; toast(soundOn ? 'Sound effects enabled' : 'Sound effects muted'); });
$('#rotateBtn').addEventListener('click', () => { autoRotate = !autoRotate; toast(autoRotate ? 'Auto rotation enabled' : 'Auto rotation paused'); scheduleSharedState(); });
$('#resetBtn').addEventListener('click', () => {
  if (activeGroup) {
    activeGroup.position.set(0, worldARActive ? 0.45 : 0, 0);
    activeGroup.rotation.set(0, 0, 0);
    activeGroup.scale.setScalar(worldARActive ? 0.35 : 1);
    $('#scaleSlider').value = 100; $('#scaleValue').textContent = '100%';
    scheduleSharedState();
  }
});
$('#scaleSlider').addEventListener('input', e => {
  const v = Number(e.target.value); $('#scaleValue').textContent = `${v}%`;
  if (activeGroup) activeGroup.scale.setScalar((v / 100) * (worldARActive ? 0.35 : 1));
  scheduleSharedState();
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

async function setMode(mode) {
  if (worldARActive) await stopWorldAR({ silent: true });
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
async function stopExperience() {
  if (worldARActive) await stopWorldAR({ silent: true });
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; video.srcObject = null; video.classList.remove('hidden'); gestureOn = false;
  $('#gestureStatus').textContent = 'OFF'; $('#gestureBtn').textContent = 'ENABLE HAND CONTROL';
  cameraMessage.classList.remove('hidden'); cameraLabel.textContent = 'CAMERA STANDBY';
  if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
  showScreen(homeScreen);
}
async function startCamera() {
  if (worldARActive) await stopWorldAR({ silent: true });
  video.classList.remove('hidden');
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
  if (renderer && scene && camera && activeGroup) {
    resizeThree();
    if (!animationId) animate();
    return;
  }
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
  loadOptionalModel(currentObject);
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
  activeGroup.scale.setScalar((Number($('#scaleSlider').value)/100) * (worldARActive ? 0.35 : 1));
  if (worldARActive) activeGroup.position.y = 0.45;
  document.querySelectorAll('[data-object]').forEach(b=>b.classList.toggle('selected',b.dataset.object===type));
  $('#tipText').textContent = `${type.toUpperCase()} selected. Drag with your finger or try hand gestures.`;
}
function selectObject(type, options = {}) {
  buildObject(type);
  loadOptionalModel(type);
  if(currentMode==='stage') setMode('stage');
  toast(`${type.toUpperCase()} hologram loaded`);
  if (!options.remote) scheduleSharedState();
}

async function loadOptionalModel(type) {
  const filename = optionalModelFiles[type];
  if (!filename || !activeGroup) return;
  const requestToken = ++activeModelLoadToken;
  try {
    const gltf = await gltfLoader.loadAsync(`/models/${filename}`);
    if (requestToken !== activeModelLoadToken || currentObject !== type || !activeGroup) return;
    clearGroup(activeGroup);
    const model = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const largestSide = Math.max(size.x, size.y, size.z) || 1;
    model.scale.setScalar(2.4 / largestSide);
    bounds.setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= bounds.min.y;
    activeGroup.add(model);
    activeGroup.scale.setScalar((Number($('#scaleSlider').value) / 100) * (worldARActive ? 0.35 : 1));
    if (worldARActive) activeGroup.position.y = 0.45;
    toast(`${type.toUpperCase()} 3D asset loaded`);
  } catch {
    // The original procedural hologram remains visible when no licensed GLB is supplied.
  }
}

function animate() {
  animationId = requestAnimationFrame(animate);
  if (!renderer || !scene || !camera) return;
  const t = clock.getElapsedTime();
  if (activeGroup) {
    if (autoRotate && !grabbed) activeGroup.rotation.y += 0.004;
    if (!worldARActive) activeGroup.position.y = Math.sin(t*1.1)*.07;
    if (grabbed) {
      activeGroup.position.x += (handTarget.x-activeGroup.position.x)*.18;
      activeGroup.position.y += (handTarget.y-activeGroup.position.y)*.18;
    }
  }
  if (worldARActive && zapparCamera) {
    zapparCamera.updateFrame(renderer);
    if (!worldARPlaced && worldTracker) worldTracker.setAnchorPoseFromCameraOffset(0, 0, -2.5);
    renderer.render(scene, zapparCamera);
  } else {
    renderer.render(scene, camera);
    if (video.readyState >= 2 && gestureOn && performance.now()-lastDetect>75) detectHands();
    if (video.readyState >= 2 && currentMode==='mirror' && performance.now()-lastFaceDetect>90) detectFace();
  }
}
function screenToWorld(x,y) {
  const rect=threeCanvas.getBoundingClientRect();
  const nx=((x-rect.left)/rect.width)*2-1, ny=-((y-rect.top)/rect.height)*2+1;
  const v=new THREE.Vector3(nx,ny,.5).unproject(camera);
  const dir=v.sub(camera.position).normalize();
  return camera.position.clone().add(dir.multiplyScalar((0-camera.position.z)/dir.z));
}
threeCanvas.addEventListener('pointerdown', e => {
  if (worldARActive || !activeGroup || currentMode==='mirror') return;
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
  if (worldARActive) { toast('Exit Surface AR before enabling hand tracking.'); return; }
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
async function startWorldAR() {
  if (worldARActive) return;
  if (!renderer) initThree();

  // Android Chrome can use native WebXR hit-testing for actual detected surfaces.
  // Call requestSession directly from the tap handler so the browser's user activation is retained.
  let nativeSession = null;
  const isAndroid = /Android/i.test(navigator.userAgent);
  if (isAndroid && navigator.xr?.requestSession) {
    try {
      nativeSession = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.body }
      });
    } catch (error) {
      console.info('WebXR hit-test is not available; trying the cross-browser tracking engine.', error);
    }
  }

  if (nativeSession) {
    try {
      await activateWebXRSurfaceSession(nativeSession);
      return;
    } catch (error) {
      console.error('WebXR surface AR failed:', error);
      try { await nativeSession.end(); } catch { /* best effort */ }
      // A failure can happen after the renderer was switched to XR mode.
      // Restore the ordinary camera-overlay renderer before trying the fallback.
      finishWebXRSession();
      toast('Native surface tracking failed. Trying the browser AR engine…');
    }
  }

  const ZapparThree = window.ZapparThree || await zapparSdkPreload;
  if (!ZapparThree?.Camera || !ZapparThree?.InstantWorldTracker || !ZapparThree?.InstantWorldAnchorGroup) {
    toast('Markerless AR engine is unavailable. Check the SDK connection and license setup.');
    return;
  }
  try {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
    }
    if (ZapparThree.browserIncompatible?.()) {
      ZapparThree.browserIncompatibleUI?.();
      return;
    }

    $('#worldArStatus').textContent = 'REQUESTING';
    const granted = await ZapparThree.permissionRequest();
    if (!granted) throw new Error('Camera and motion permissions are required for surface AR.');

    ZapparThree.glContextSet(renderer.getContext());
    zapparCamera = new ZapparThree.Camera();
    scene.background = zapparCamera.backgroundTexture;
    zapparCamera.start();

    worldTracker = new ZapparThree.InstantWorldTracker();
    worldAnchorGroup = new ZapparThree.InstantWorldAnchorGroup(zapparCamera, worldTracker);
    scene.add(worldAnchorGroup);
    scene.remove(activeGroup);
    worldAnchorGroup.add(activeGroup);

    activeGroup.position.set(0, 0.45, 0);
    activeGroup.rotation.set(0, 0, 0);
    activeGroup.scale.setScalar((Number($('#scaleSlider').value) / 100) * 0.35);
    worldARActive = true;
    worldARMode = 'zappar';
    worldARPlaced = false;
    video.classList.add('hidden');
    cameraMessage.classList.add('hidden');
    cameraLabel.textContent = 'WORLD TRACKING ACTIVE';
    $('#worldArStatus').textContent = 'SCANNING';
    $('#worldArBtn').classList.add('hidden');
    $('#placeWorldObjectBtn').classList.remove('hidden');
    $('#stopWorldArBtn').classList.remove('hidden');
    $('#placeWorldObjectBtn').textContent = 'PLACE OBJECT';
    $('#tipText').textContent = 'Move your phone slowly to map the room, aim at a surface, then place the object.';
    toast('World tracking active. Slowly scan the room before placing the model.');
  } catch (error) {
    console.error('Surface AR start failed:', error);
    zapparCamera?.stop?.();
    zapparCamera = null;
    $('#worldArStatus').textContent = 'STANDBY';
    if (scene) scene.background = null;
    cameraMessage.classList.remove('hidden');
    toast(error.message || 'Could not start surface AR on this device.');
  }
}

async function activateWebXRSurfaceSession(session) {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
  }
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  worldArSession = session;
  worldArLocalSpace = await session.requestReferenceSpace('local');
  const viewerSpace = await session.requestReferenceSpace('viewer');
  worldArHitTestSource = await session.requestHitTestSource({ space: viewerSpace });

  worldArReticle = new THREE.Mesh(
    new THREE.RingGeometry(0.09, 0.13, 36),
    new THREE.MeshBasicMaterial({ color: 0x53e8ff, side: THREE.DoubleSide })
  );
  worldArReticle.rotation.x = -Math.PI / 2;
  worldArReticle.matrixAutoUpdate = false;
  worldArReticle.visible = false;
  scene.add(worldArReticle);
  activeGroup.visible = false;
  activeGroup.scale.setScalar((Number($('#scaleSlider').value) / 100) * 0.35);
  worldARActive = true;
  worldARMode = 'webxr';
  worldARPlaced = false;
  video.classList.add('hidden');
  cameraMessage.classList.add('hidden');
  cameraLabel.textContent = 'WEBXR SURFACE TRACKING';
  $('#worldArStatus').textContent = 'SCANNING SURFACES';
  $('#worldArBtn').classList.add('hidden');
  $('#placeWorldObjectBtn').classList.remove('hidden');
  $('#stopWorldArBtn').classList.remove('hidden');
  $('#placeWorldObjectBtn').textContent = 'PLACE OBJECT';
  $('#tipText').textContent = 'Move the phone to detect a real surface. Aim at the reticle and tap PLACE OBJECT.';

  if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
  renderer.setAnimationLoop((time, frame) => {
    if (!frame || !worldArHitTestSource || !worldArLocalSpace) return;
    const hits = frame.getHitTestResults(worldArHitTestSource);
    if (!worldARPlaced && hits.length) {
      const pose = hits[0].getPose(worldArLocalSpace);
      if (pose && worldArReticle) {
        worldArReticle.visible = true;
        worldArReticle.matrix.fromArray(pose.transform.matrix);
        worldArReticle.matrixWorldNeedsUpdate = true;
      }
    } else if (worldArReticle) {
      worldArReticle.visible = false;
    }
    if (activeGroup && worldARPlaced && autoRotate) activeGroup.rotation.y += 0.004;
    renderer.render(scene, camera);
  });

  session.addEventListener('select', lockWebXRPlacement);
  session.addEventListener('end', finishWebXRSession, { once: true });
  toast('Surface detection ready. Move the phone slowly until the reticle appears.');
}

function lockWebXRPlacement() {
  if (worldARMode !== 'webxr' || worldARPlaced || !worldArReticle?.visible || !activeGroup) return;
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const ignoredScale = new THREE.Vector3();
  worldArReticle.matrix.decompose(position, quaternion, ignoredScale);
  activeGroup.position.copy(position);
  activeGroup.quaternion.copy(quaternion);
  activeGroup.visible = true;
  worldARPlaced = true;
  $('#worldArStatus').textContent = 'ANCHORED LOCALLY';
  $('#placeWorldObjectBtn').textContent = 'REPOSITION OBJECT';
  $('#tipText').textContent = 'Object is anchored to this device’s detected surface. Classroom sync shares model edits, not physical coordinates.';
  toast('Object placed on the detected surface.');
}

function toggleWorldPlacement() {
  if (!worldARActive) return;
  if (worldARMode === 'webxr') {
    if (worldARPlaced) {
      worldARPlaced = false;
      activeGroup.visible = false;
      $('#worldArStatus').textContent = 'SCANNING SURFACES';
      $('#placeWorldObjectBtn').textContent = 'PLACE OBJECT';
      return;
    }
    lockWebXRPlacement();
    return;
  }
  if (!worldTracker) return;
  worldARPlaced = !worldARPlaced;
  $('#worldArStatus').textContent = worldARPlaced ? 'ANCHORED LOCALLY' : 'SCANNING';
  $('#placeWorldObjectBtn').textContent = worldARPlaced ? 'REPOSITION OBJECT' : 'PLACE OBJECT';
  $('#tipText').textContent = worldARPlaced
    ? 'Object anchored in this phone’s local world map. Room controls sync model settings, not physical coordinates.'
    : 'Aim at the desired location and tap PLACE OBJECT.';
  toast(worldARPlaced ? 'Object placement fixed on this device.' : 'Choose a new placement point.');
}

function finishWebXRSession() {
  if (renderer) renderer.setAnimationLoop(null);
  try { worldArHitTestSource?.cancel?.(); } catch { /* session may already be closed */ }
  if (worldArReticle) scene?.remove(worldArReticle);
  worldArReticle = null;
  worldArHitTestSource = null;
  worldArLocalSpace = null;
  worldArSession = null;
  worldARActive = false;
  worldARMode = null;
  worldARPlaced = false;
  if (renderer) renderer.xr.enabled = false;
  if (activeGroup) activeGroup.visible = true;
  $('#worldArStatus').textContent = 'STANDBY';
  $('#worldArBtn').classList.remove('hidden');
  $('#placeWorldObjectBtn').classList.add('hidden');
  $('#stopWorldArBtn').classList.add('hidden');
  $('#cameraLabel').textContent = 'CAMERA STANDBY';
  cameraMessage.classList.remove('hidden');
  if (!animationId) animate();
}

async function stopWorldAR(options = {}) {
  if (worldARMode === 'webxr' && worldArSession) {
    const session = worldArSession;
    try { await session.end(); } catch (error) { console.warn('WebXR session end failed', error); }
    finishWebXRSession();
    if (!options.silent) toast('Surface AR closed.');
    return;
  }
  if (!worldARActive && !zapparCamera) return;
  worldARActive = false;
  worldARMode = null;
  worldARPlaced = false;
  try { zapparCamera?.stop?.(); } catch (error) { console.warn('Zappar camera stop failed', error); }
  if (worldAnchorGroup && activeGroup) {
    worldAnchorGroup.remove(activeGroup);
    scene?.remove(worldAnchorGroup);
    scene?.add(activeGroup);
  }
  zapparCamera = null;
  worldTracker = null;
  worldAnchorGroup = null;
  if (scene) scene.background = null;
  video.classList.remove('hidden');
  $('#worldArStatus').textContent = 'STANDBY';
  $('#worldArBtn').classList.remove('hidden');
  $('#placeWorldObjectBtn').classList.add('hidden');
  $('#stopWorldArBtn').classList.add('hidden');
  $('#cameraLabel').textContent = 'CAMERA STANDBY';
  cameraMessage.classList.remove('hidden');
  if (!options.silent) toast('Surface AR closed.');
}

function getSharedObjectState() {
  if (!activeGroup) return null;
  return {
    objectType: currentObject,
    scale: Number($('#scaleSlider').value) / 100,
    rotationX: activeGroup.rotation.x,
    rotationY: activeGroup.rotation.y,
    rotationZ: activeGroup.rotation.z,
    autoRotate
  };
}

function scheduleSharedState() {
  if (applyingRemoteState || !getActiveRoom()) return;
  clearTimeout(roomPublishTimer);
  roomPublishTimer = setTimeout(async () => {
    const state = getSharedObjectState();
    if (!state) return;
    try { await publishRoomState(state); }
    catch (error) { console.error('Could not publish classroom state:', error); setRoomMessage(error.message, true); }
  }, 220);
}

function applyRemoteRoomState(state) {
  if (!state || typeof state !== 'object') return;
  applyingRemoteState = true;
  try {
    if (state.objectType && state.objectType !== currentObject) selectObject(state.objectType, { remote: true });
    if (activeGroup) {
      const factor = worldARActive ? 0.35 : 1;
      const scale = Math.min(1.8, Math.max(0.5, Number(state.scale) || 1));
      $('#scaleSlider').value = Math.round(scale * 100);
      $('#scaleValue').textContent = `${Math.round(scale * 100)}%`;
      activeGroup.scale.setScalar(scale * factor);
      activeGroup.rotation.set(Number(state.rotationX) || 0, Number(state.rotationY) || 0, Number(state.rotationZ) || 0);
      if (worldARActive) activeGroup.position.y = 0.45;
    }
    if (typeof state.autoRotate === 'boolean') autoRotate = state.autoRotate;
  } finally {
    applyingRemoteState = false;
  }
}

function setRoomMessage(message, isError = false) {
  const node = $('#roomMessage');
  node.textContent = message;
  node.style.color = isError ? '#ff9f9f' : '';
}

function renderParticipants(participants = []) {
  const list = $('#participantList');
  list.replaceChildren();
  if (!participants.length) {
    list.textContent = 'Waiting for participants…';
    return;
  }
  participants.forEach((person) => {
    const row = document.createElement('div');
    row.className = 'participant-entry';
    const name = document.createElement('span');
    name.textContent = person.name || 'Student';
    const role = document.createElement('small');
    role.textContent = person.role || 'student';
    row.append(name, role);
    list.append(row);
  });
}

async function showRoomInvite(room) {
  $('#roomSharePanel').classList.remove('hidden');
  $('#activeRoomCode').textContent = room.code;
  $('#roomCodeInput').value = room.code;
  const url = new URL(window.location.href);
  url.searchParams.set('room', room.code);
  try {
    await QRCode.toCanvas($('#roomQrCanvas'), url.toString(), {
      width: 176, margin: 1,
      color: { dark: '#061626', light: '#ffffff' },
      errorCorrectionLevel: 'M'
    });
  } catch (error) { console.error('QR generation failed:', error); }
}

async function handleCreateRoom() {
  const displayName = $('#displayName').value.trim();
  if (!displayName) { setRoomMessage('Enter your name first.', true); $('#displayName').focus(); return; }
  if (!collaborationConfigured) { setRoomMessage('Supabase is not configured. Add the environment variables and run the SQL migration.', true); return; }
  $('#createRoomBtn').disabled = true;
  try {
    const connected = await createSharedRoom($('#roomTitle').value.trim(), displayName);
    await showRoomInvite(connected.room);
    $('#roomStatus').textContent = 'LIVE';
    $('#roomStatus').style.color = '#59ffc0';
    setRoomMessage(`You are hosting “${connected.room.title}”. Share the QR or invitation link.`);
    const state = await loadRoomState();
    if (state) applyRemoteRoomState(state);
    toast('Classroom created. Invite your students!');
  } catch (error) {
    console.error('Create room failed:', error);
    setRoomMessage(error.message || 'Could not create the classroom.', true);
  } finally { $('#createRoomBtn').disabled = false; }
}

async function handleJoinRoom() {
  const displayName = $('#displayName').value.trim();
  const code = $('#roomCodeInput').value.trim();
  if (!displayName) { setRoomMessage('Enter your name first.', true); $('#displayName').focus(); return; }
  if (!collaborationConfigured) { setRoomMessage('Supabase is not configured. Add the environment variables and run the SQL migration.', true); return; }
  $('#joinRoomBtn').disabled = true;
  try {
    const connected = await joinSharedRoom(code, displayName);
    await showRoomInvite(connected.room);
    $('#roomStatus').textContent = 'LIVE';
    $('#roomStatus').style.color = '#59ffc0';
    setRoomMessage(`Connected to “${connected.room.title}”. The shared model state is live.`);
    const state = await loadRoomState();
    if (state) applyRemoteRoomState(state);
    toast(`Joined classroom ${connected.room.code}.`);
  } catch (error) {
    console.error('Join room failed:', error);
    setRoomMessage(error.message || 'Could not join the classroom.', true);
  } finally { $('#joinRoomBtn').disabled = false; }
}

async function copyRoomInvite() {
  const room = getActiveRoom();
  if (!room) return;
  const url = new URL(window.location.href);
  url.searchParams.set('room', room.code);
  try {
    await navigator.clipboard.writeText(url.toString());
    toast('Classroom invitation link copied.');
  } catch {
    setRoomMessage(`Copy this invitation link: ${url.toString()}`, true);
  }
}

async function handleLeaveRoom() {
  try { await leaveSharedRoom(); } catch (error) { console.warn(error); }
  $('#roomSharePanel').classList.add('hidden');
  $('#roomStatus').textContent = 'OFFLINE';
  $('#roomStatus').style.color = '';
  renderParticipants([]);
  setRoomMessage('You left the classroom.');
  toast('Classroom disconnected.');
}

onRoomEvent('participants', renderParticipants);
onRoomEvent('state', applyRemoteRoomState);
onRoomEvent('disconnected', () => {
  $('#roomStatus').textContent = 'OFFLINE';
  $('#roomStatus').style.color = '';
});

const invitedRoomCode = new URLSearchParams(window.location.search).get('room');
if (invitedRoomCode) $('#roomCodeInput').value = invitedRoomCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
if (!collaborationConfigured) {
  $('#roomStatus').textContent = 'SETUP';
  setRoomMessage('Add Supabase URL and publishable key to enable shared classrooms.');
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
