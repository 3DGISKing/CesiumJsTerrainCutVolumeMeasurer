### 1.0.1 - 2026-07-16

#### Updated

- Upgraded Cesium CDN references in `index.html` to `1.143` (`Cesium.js` and `Widgets/widgets.css`).
- Switched terrain initialization to `await Cesium.createWorldTerrainAsync(...)` with vertex normals and water mask options.
- Replaced removed `defaultValue(...)` API usage with nullish coalescing (`??`) in `PolygonPrimitive.js` and `PolylinePrimitive.js`.
- Replaced `SceneTransforms.wgs84ToWindowCoordinates(...)` with `SceneTransforms.worldToWindowCoordinates(...)` in `CutVolumeMeasurer.js`.

### 1.0 - 2023-06-26

#### Updated

- use ES6, Primitive API, Promise for user interaction.
