# 3D model replacement — FUTURE VISION XR 3.1

The previous procedural demo shapes were removed from the selector and replaced with seven assets from the user-provided `Objetos 3D.rar` archive. Browser-ready GLB versions are stored in `public/models/`.

| UI label | GLB | Source conversion |
|---|---|---|
| Robot | `robot.glb` | Supplied animated GLB; first animation clip plays automatically |
| Cybertruck | `cybertruck.glb` | Supplied GLB, re-exported and optimized |
| Mars | `mars.glb` | Supplied GLB; 8192 px material maps resized to 2048 px |
| Moon | `moon.glb` | New UV sphere mesh using lunar albedo, normal and roughness maps unpacked from the supplied Blender file |
| Space Station | `satellite.glb` | Supplied OBJ + packed body and foil textures, converted to GLB with material assignments |
| Falcon 9 Heavy | `falcon9-heavy.glb` | Supplied OBJ + available base-color texture atlases, converted to GLB |
| SpaceX BFR | `spacex-big-falcon.glb` | Supplied OBJ + texture archive, fixed desktop-only texture paths, converted to GLB |

All GLB files were reopened and inspected after export using a GLTF-capable scene parser. The browser loader normalizes model dimensions and applies orientation corrections. Device-side visual testing is still required for scale, orientation, materials, performance and animation playback.

The supplied archive did not contain license documents. Verify the original creator's license and attribution terms before publishing or commercial use.
