### 1.0.2 - 2026-07-16

#### Updated

- Optimized `_doComputeCutVolume` by converting each vertex to cartographic coordinates once, using a faster cross-product triangle area calculation, and building fill/wireframe meshes in a single pass with preallocated typed arrays.
- Merged `_drawFillMesh` and `_drawWireframeOfTopTriangles` into `_buildVisualizationMeshes` and extracted shared primitive creation into `_createColoredPrimitive`.

#### Fixed

- Updated `Cartesian3.fromRadians(...)` calls to pass `Ellipsoid.WGS84` before the scratch result object for Cesium 1.143 compatibility.
- Added fallback to original positions when `clampToHeightMostDetailed` returns `undefined`, preventing a crash after the progress bar completes.

### 1.0.1 - 2026-07-16

#### Updated

- Upgraded Cesium CDN references in `index.html` to `1.143` (`Cesium.js` and `Widgets/widgets.css`).
- Switched terrain initialization to `await Cesium.createWorldTerrainAsync(...)` with vertex normals and water mask options.
- Replaced removed `defaultValue(...)` API usage with nullish coalescing (`??`) in `PolygonPrimitive.js` and `PolylinePrimitive.js`.
- Replaced `SceneTransforms.wgs84ToWindowCoordinates(...)` with `SceneTransforms.worldToWindowCoordinates(...)` in `CutVolumeMeasurer.js`.

### 1.0 - 2023-06-26

#### Updated

- use ES6, Primitive API, Promise for user interaction.
