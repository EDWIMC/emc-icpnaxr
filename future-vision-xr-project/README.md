# FUTURE VISION XR

Interactive English technology exhibition website by Edwin Maza Castro.

## Features in this starter project

- Responsive dark futuristic interface.
- Rear-camera experience with Three.js procedural 3D objects: robot, AI brain, futuristic car, smartphone, satellite and smart city.
- Touch drag, scale slider, rotation and reset controls.
- Optional hand tracking using MediaPipe Tasks Vision. Pinch thumb and index finger to grab and move the hologram.
- Front-camera face effects: cyber visor, neon glasses, hologram crown and face scanner.
- Camera switch and fullscreen mode.
- Vercel-ready static deployment.

## Important technical notes

This is a browser-based AR-style camera overlay, not full world-locked spatial AR. The 3D object is rendered over the live camera view. For a classroom demo, place the phone on a stable surface and use the on-screen object controls or hand tracking.

The hand tracker uses the MediaPipe Hand Landmarker model from Google's hosted model storage and a CDN. It requires internet access and a browser that supports camera access and WebGL. Hand tracking is optional; touch controls remain available.

The face experience draws visual effects based on face landmarks. It does not perform realistic full-body clothing replacement, hair replacement or identity transformation.

The app uses the front camera for the face mirror and the rear camera for holograms. Camera access requires HTTPS (Vercel provides HTTPS) or localhost during development. iOS Safari may ask for camera permission after a user gesture. Some older devices may not support the GPU delegate; if model initialization fails, use touch mode.

## Run locally

Install Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open the local URL shown by Vite. Test on a phone connected to the same Wi-Fi using your computer's LAN IP; camera access on a non-HTTPS LAN address may be blocked. Prefer deploying a preview to Vercel for real phone testing.

## Deploy to Vercel

1. Create a GitHub repository named `future-vision-xr`.
2. Upload all files and folders from this project.
3. Import the repository at https://vercel.com/new
4. Framework preset: Vite.
5. Build command: `npm run build`
6. Output directory: `dist`
7. Deploy.
8. Open the HTTPS URL on Android and iPhone and grant camera permission.

## Suggested classroom setup

- TV: open the landing page and display the project title / QR code to the deployed URL.
- Students: scan the QR with their phones and open the website.
- For the hologram scene: select HOLOGRAMS, activate the rear camera, choose an object.
- For gesture control: tap ENABLE HAND CONTROL, wait for the model to load, show one hand clearly, pinch thumb and index finger, and move the hand.
- For the face scene: select AR MIRROR; the app switches to the front camera. Select an effect.

## Recommended 1–2 day test plan

1. Day 1: deploy, test rear camera on at least one Android and one iPhone, test touch controls and all object choices.
2. Day 1: test MediaPipe hand tracking on the fastest available Android phone. Keep the gesture button optional.
3. Day 2: test front camera filters and rehearse the English narration. Keep a backup video or screenshots in case a phone blocks camera access.

## English demo lines

- "Welcome to Future Vision XR. The future is in your hands."
- "This is an interactive hologram of a humanoid robot."
- "Artificial intelligence can help machines learn and make decisions."
- "Use your fingers to grab and move the virtual object."
- "Augmented reality combines digital content with the real world."
- "Imagine how technology could change our lives by 2050."
