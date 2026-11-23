# FUTURE VISION XR — shared physical anchors (VPS)

## Current release boundary

This repository contains the collaborative classroom foundation and local Surface AR modes. It synchronizes the model type, scale, rotation and auto-rotation through Supabase. It does **not** yet synchronize a physical anchor across devices. A local world-tracking origin on one phone is not a shared classroom coordinate system.

Do not advertise the current build as same-table / same-point multi-device AR.

## Recommended provider to validate: AR Clip VPS Web SDK

The current AR Clip documentation describes a browser Web SDK (`@web-ar-studio/webar-engine-sdk`) that localizes each visitor against a previously captured VPS map. Its documented browser path is:

- Chrome on Android: WebXR tracking with VPS; the SDK applies the map offset to the scene.
- Safari on iPhone and browsers without WebXR: 8th Wall tracking with VPS; the application applies the inverse VPS offset to the map-content group.
- A QR/link can open the WebAR scene in the browser without requiring students to install an app.

Official documentation:

- Web SDK: https://docs.arclip.design/vps/Web%20SDK/web_intro/
- Supported devices: https://docs.arclip.design/vps/getting-started/compatibility/
- Mapping with AR Clip: https://docs.arclip.design/vps/spatial-mapping/building-map/arclip-mapper/
- Pricing and limits: https://docs.arclip.design/vps/getting-started/pricing/

The documentation states that the Web SDK requires an API key and one or more VPS map `locationIds`. The map-capture guide currently describes capture through the AR Clip iOS app; it says Android map capture is not available in that workflow. Students viewing an already mapped space can still use the browser WebAR experience.

## Required onboarding before implementation can be activated

1. Create an AR Clip account/team and request an API key from the provider.
2. Use the AR Clip iOS app to capture the classroom/room as a VPS map.
3. Run the provider's localization test throughout the intended student area. Avoid reflective, featureless or frequently rearranged surfaces; test the actual classroom lighting and furniture.
4. Record the map `locationId` and configure it for the activity.
5. Add the provider SDK to the Vite application and initialize a SLAM session with `vps: { locationIds: [...] }` from a user gesture.
6. Keep all shared model transforms in the common VPS map coordinate system. Do not persist one device's local tracking coordinates as the room anchor.
7. On the 8th Wall provider, apply the inverse localization offset to a dedicated `mapRoot` group; on the WebXR provider, the SDK documentation says it applies the offset itself.
8. Persist the shared map-space transform (`position`, `orientation`, `scale`) in `xr_room_state.object_state`, and broadcast updates through the existing Supabase room channel.
9. Validate alignment using at least two Android phones and two iPhones in the same room. Measure the actual offset at the target tabletop. Do not describe it as exact until those tests pass.

## Important accuracy and dependency caveats

VPS is a mapped-space localization system, not a guarantee of millimetre-perfect registration. The provider's published material describes sub-metre positioning. A school activity may find that adequate, but a small tabletop object may need more precision. Test the actual required tolerance before committing to deployment.

The provider's pricing page currently lists a Free plan with up to 1,000 unique views/month and a Creator plan listed at USD 49/month; pricing, limits, supported SDKs and terms can change. Check the live plan before publishing commercially or to a school.

## Why this is not switched on by default in this ZIP

The supplied project ZIP did not include an AR Clip API key, a VPS `locationId`, a classroom map, or access to the provider project. Those are required to test localization. The current code therefore keeps its clearly labelled per-device AR paths and does not pretend that Supabase room synchronization alone provides a physical shared anchor.
