# FUTURE VISION XR 3.0

Responsive educational XR experience with markerless local world tracking, a synchronized classroom prototype, QR invitations, Three.js content, optional GLB assets, MediaPipe hand/face features, and Vercel deployment support.

## What is included

- Original FUTURE VISION XR landing page, dark futuristic visual identity, existing Hologram Lab, AR Mirror, and 2050 World modes.
- Markerless surface/world tracking through the pinned Zappar Three.js Universal AR SDK (camera + motion permissions required).
- Local world anchor placement: Android may use WebXR hit-test to place on detected planes; iPhone uses Zappar Instant World Tracking with a camera-offset placement. Both are per-device anchors.
- Supabase anonymous guest sessions, teacher-created rooms, 8-character join codes, QR/link invitations, participant presence, private Realtime channels, and persistent shared model state.
- Shared object selection, scale, rotation and auto-rotation settings. Each phone still has its own physical world origin.
- Optional GLB model loading. If a GLB file is not present, the original procedural hologram remains as a fallback.
- Original MediaPipe hand gestures and face effects remain available in camera-overlay modes.

## Critical limitation: physical multi-device alignment

This release does **not** claim that the same object is locked to exactly the same physical point on every phone. Zappar Instant World Tracking creates a local world-tracked anchor per device. Supabase can synchronize the model and its settings, but it cannot convert independent camera coordinate systems into one shared classroom coordinate system.

To achieve true same-table / same-point alignment without a printed marker, FUTURE VISION XR needs a shared spatial localization layer, such as a room mapped with a VPS that can localize all devices into the same map. This is a separate service and is not configured in this repository. Native ARCore/ARKit shared-anchor approaches are another path, but they do not provide a universal browser-only solution across all iPhones and Android phones.

Until that layer is added, the app clearly identifies anchors as **local to each device**. The synchronized classroom shares model state, not physical coordinates.

## Next step for true same-table physical anchors

For the selected **physical shared-anchor** requirement, evaluate the AR Clip VPS Web SDK rather than treating the current local tracking modes as a shared map. Its current documentation describes Web VPS localization on Chrome Android (WebXR) and Safari iPhone (8th Wall), and says students can open a WebAR experience from a QR/link without installing an app. It requires an API key and a VPS map `locationId`. The mapping guide currently describes capturing the room with the AR Clip iOS app.

This provider is **not activated in this ZIP** because the supplied project did not include an AR Clip API key or mapped classroom location. See [`docs/PHYSICAL-ANCHOR-ROADMAP.md`](docs/PHYSICAL-ANCHOR-ROADMAP.md) before claiming cross-device physical alignment. The existing Supabase JSON state is ready to store a future shared map-space transform, but the current application does not yet localize every phone against that map.

- Web SDK: https://docs.arclip.design/vps/Web%20SDK/web_intro/
- Compatibility: https://docs.arclip.design/vps/getting-started/compatibility/
- Mapping: https://docs.arclip.design/vps/spatial-mapping/building-map/arclip-mapper/
- Pricing: https://docs.arclip.design/vps/getting-started/pricing/

## Requirements

- Node.js 18 or newer.
- HTTPS in production (Vercel provides HTTPS).
- Rear camera and motion-sensor permission for markerless world tracking.
- A mobile Safari browser on a supported iPhone or Chrome on a recent Android device for Zappar Universal AR. Test the exact devices used in class.
- Supabase project with Anonymous Sign-Ins enabled and Realtime available.

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL. For camera testing on physical phones, use an HTTPS preview deployment rather than an unsecured LAN address.

## Configure Supabase classrooms

1. Create a Supabase project.
2. In **Authentication → Providers / Sign In**, enable **Anonymous Sign-Ins**.
3. Open **SQL Editor** and run `supabase/migrations/202611230001_future_vision_xr_rooms.sql`.
4. Copy `.env.example` to `.env.local`.
5. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or the legacy anon key).
6. Restart Vite.
7. In Vercel, add the same two variables to Production, Preview and Development environments, then redeploy.

Only the Supabase publishable/anon key belongs in the browser. **Never** add a Supabase service-role key to a `VITE_` variable or to this repository.

## Add high-quality 3D models

Place optimized, licensed `.glb` files in `public/models/` using these exact names:

| Object | File |
|---|---|
| Robot | `robot.glb` |
| AI brain | `brain.glb` |
| Future car | `future-car.glb` |
| Smartphone | `smartphone.glb` |
| Satellite | `satellite.glb` |
| Smart city | `smart-city.glb` |

The loader normalizes the largest model dimension to approximately 2.4 scene units and places the model base at the local origin. Keep models optimized for mobile (reasonable polygon counts, compressed textures, and a modest file size). The ZIP does not include third-party 3D assets; add only assets whose licenses permit your use.

## Deploy to Vercel

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`
- Root directory: the extracted project folder containing this `package.json` (the ZIP is packaged with the project files at its root)

The included `vercel.json` configures clean URLs and security / sensor permission headers.

## Classroom test sequence

1. Deploy and configure Supabase first.
2. On a teacher phone, open the lab, enter a display name and create a classroom.
3. Share the QR/link with a second phone and join using the same room code.
4. Verify both devices appear in the participant list.
5. Select a model and change its scale / rotation. Confirm those settings synchronize.
6. On each phone separately, start Surface AR, grant camera/motion permission, scan slowly, and place the object.
7. Confirm that the object is stable relative to each phone's local environment. Do not interpret similar-looking placements as proof of shared physical coordinates.
8. Test iPhone Safari and Android Chrome separately, plus device heat, battery, low-light conditions, and network interruptions.

## Third-party SDK and licensing

The app loads Zappar Three.js Universal AR SDK version `4.3.0` from Zappar's official CDN on demand. The Three.js peer version is pinned to the SDK's documented supported range. Important: Zappar's documentation states that its MIT wrapper depends on the proprietary `@zappar/zappar-cv` computer-vision library, requires an active ZapWorks subscription, and requires the self-hosted domain to be registered with ZapWorks. The Vercel production domain must therefore be registered and the applicable subscription/license must be active before markerless Surface AR will work on the public deployment. Verify current pricing and terms directly with Zappar before using this in a school or commercial setting. The SDK provides local Instant World Tracking; it does not by itself provide the shared VPS anchor required for cross-device physical alignment.

- Zappar Three.js docs: https://docs.zap.works/universal-ar/threejs/
- Instant World Tracking: https://docs.zap.works/universal-ar/threejs/tracking/instant-world-tracking/
- Compatibility: https://docs.zap.works/universal-ar/threejs/getting-started/compatibility/
- Supabase Realtime: https://supabase.com/docs/guides/realtime
