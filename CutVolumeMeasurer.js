const {
    BoundingSphere,
    Cartesian2,
    Cartesian3,
    Cartographic,
    Color,
    ColorGeometryInstanceAttribute,
    ComponentDatatype,
    Event,
    Ellipsoid,
    Geometry,
    GeometryPipeline,
    GeometryAttribute,
    GeometryInstance,
    HorizontalOrigin,
    LabelCollection,
    LabelStyle,
    Matrix4,
    PerInstanceColorAppearance,
    PolygonGeometry,
    Primitive,
    PrimitiveType,
    SceneTransforms,
    ScreenSpaceEventHandler,
    ScreenSpaceEventType,
    Transforms,
    VerticalOrigin
} = window.Cesium;

const CesiumMath = window.Cesium.Math;

import BillboardGroup from "./BillboardGroup.js"
import PolygonPrimitive from "./PolygonPrimitive.js";
import PolylinePrimitive from "./PolylinePrimitive.js";
import Toolbar from "./Toolbar.js"
import Tooltip from "./Tooltip.js"

const defaultBillboard = {
    iconUrl: "./img/dragIcon.png",
    shiftX: 0,
    shiftY: 0
};

function computeAreaOfTriangle(pos1, pos2, pos3) {
    const a = Cartesian3.distance(pos1, pos2);
    const b = Cartesian3.distance(pos2, pos3);
    const c = Cartesian3.distance(pos3, pos1);

    const S = (a + b + c) / 2;

    return Math.sqrt(S * (S - a) * (S - b) * (S - c));
}

function computeCentroidOfPolygon(positions) {
    const x = [];
    const y = [];

    for (let i = 0; i < positions.length; i++) {
        const cartographic = Cartographic.fromCartesian(positions[i]);

        x.push(cartographic.longitude);
        y.push(cartographic.latitude);
    }

    let x0 = 0.0, y0 = 0.0, x1 = 0.0, y1 = 0.0;
    let signedArea = 0.0;
    let a = 0.0;
    let centroidX = 0.0, centroidY = 0.0;

    for (let i = 0; i < positions.length; i++) {
        x0 = x[i];
        y0 = y[i];

        if (i === positions.length - 1) {
            x1 = x[0];
            y1 = y[0];
        } else {
            x1 = x[i + 1];
            y1 = y[i + 1];
        }

        a = x0 * y1 - x1 * y0;
        signedArea += a;
        centroidX += (x0 + x1) * a;
        centroidY += (y0 + y1) * a;
    }

    signedArea *= 0.5;
    centroidX /= (6.0 * signedArea);
    centroidY /= (6.0 * signedArea);

    return new Cartographic(centroidX, centroidY);
}

export default class CutVolumeMeasurer {
    constructor(viewer) {
        this._scene = viewer.scene;
        this._tooltip = new Tooltip(viewer.container);
        this._mouseHandler = undefined;
        this._markers = undefined;
        this._positions = [];

        this._centerOfFillMesh = undefined;
        this._granularity = 1; // 1 ~ 16
        this._verticalOffset = 100;
        this._canceled = false;
        this._progress = new Event();

        const primitives = this._scene.primitives;

        this._polygon = primitives.add(new PolygonPrimitive({
            color: Color.BLUE.withAlpha(0.2),
            show: true
        }));

        this._polyline = primitives.add(new PolylinePrimitive({
            color: Color.YELLOW,
            width: 2,
            loop: true
        }));

        this._labelCollection = primitives.add(new LabelCollection());
        this._primitiveFillMesh = undefined;
        this._primitiveWireframe = undefined;
    }

    addToolbar(container) {
        this._toolbar = new Toolbar(this, {container: container});
    }

    startDrawing() {
        const scene = this._scene;
        const tooltip = this._tooltip;

        const mouseHandler = new ScreenSpaceEventHandler(scene.canvas);
        this._mouseHandler = mouseHandler;

        const markers = new BillboardGroup(scene, defaultBillboard);
        this._markers = markers;

        const positions = [];
        this._positions = positions;

        const minPoints = 3;

        const tmpNextMarker = markers.addBillboard(new Cartesian3());

        mouseHandler.setInputAction(function (movement) {
            // check if drawing is finished.
            if (positions.length >= minPoints) {
                const firstPointScreenPosition = SceneTransforms.wgs84ToWindowCoordinates(scene, positions[0]);

                if (firstPointScreenPosition !== undefined) {
                    const dx = firstPointScreenPosition.x - movement.position.x;
                    const dy = firstPointScreenPosition.y - movement.position.y;

                    const delta = dx * dx + dy * dy;
                    const tolerance = 16;

                    if (delta < tolerance) {
                        this._stopDrawing();
                        return;
                    }
                }
            }

            const ray = scene.camera.getPickRay(movement.position);
            const cartesian = scene.globe.pick(ray, scene);

            // add new point to point array
            // this one will move with the mouse
            positions.push(cartesian);

            // add marker at the new position
            markers.addBillboard(cartesian);

            this._polyline.positions = this.clonedPositions;
            this._polygon.positions = this.clonedPositions;
        }.bind(this), ScreenSpaceEventType.LEFT_CLICK);

        mouseHandler.setInputAction(function (movement) {
            const position = movement.endPosition;

            if (positions.length === 0) {
                tooltip.showAt(position, "<p>Click to add first point</p>");
            } else {
                const ray = scene.camera.getPickRay(position);
                const cartesian = scene.globe.pick(ray, scene);

                if (!cartesian) {
                    return;
                }

                tmpNextMarker.position = cartesian;

                const tempPositions = this.clonedPositions;

                tempPositions.push(cartesian);

                this._polyline.positions = tempPositions;
                this._polygon.positions = tempPositions;

                // show tooltip
                tooltip.showAt(position, `<p>Click to add new point (${positions.length}). </p>
                                                   <p>Click first point or double click to finish drawing. </p>
                `);
            }
        }.bind(this), ScreenSpaceEventType.MOUSE_MOVE);

        mouseHandler.setInputAction(function () {
            if (positions.length >= minPoints) {
                this._stopDrawing();
            }
        }.bind(this), ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    }

    _stopDrawing() {
        if (this._mouseHandler !== undefined) {
            this._mouseHandler.destroy();
            this._mouseHandler = undefined;
        }

        if (this._markers !== undefined) {
            this._markers.destroy();
            this._markers = undefined;
        }

        this._tooltip.setVisible(false);

        this.computeCutVolume();
    }

    computeCutVolume() {
        const scene = this._scene;
        const tileAvailability = scene.terrainProvider.availability;

        let maxLevel = 0;
        let minHeight = 15000;

        for (let i = 0; i < this._positions.length; i++) {
            const cartographic = Cartographic.fromCartesian(this._positions[i]);
            const height = scene.globe.getHeight(cartographic);

            if (minHeight > height)
                minHeight = height;

            const level = tileAvailability.computeMaximumLevelAtPosition(cartographic);

            if (maxLevel < level)
                maxLevel = level;
        }

        const granularity = Math.PI / Math.pow(2, (maxLevel + this._granularity));

        const polygonGeometry = new PolygonGeometry.fromPositions(
            {
                positions: this._positions,
                vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
                granularity: granularity
            }
        );

        // polygon subdivision

        const geom = new PolygonGeometry.createGeometry(polygonGeometry);
        const subTrianglePositions = geom.attributes.position.values;

        const trianglePositions = [];
        let i0, i1, i2;

        for (let i = 0; i < geom.indices.length; i += 3) {
            i0 = geom.indices[i];
            i1 = geom.indices[i + 1];
            i2 = geom.indices[i + 2];

            trianglePositions.push(Cartesian3.unpack(subTrianglePositions, i0 * 3));
            trianglePositions.push(Cartesian3.unpack(subTrianglePositions, i1 * 3));
            trianglePositions.push(Cartesian3.unpack(subTrianglePositions, i2 * 3));
        }

        const promise = this._updatePositions(trianglePositions, (progress) => {
            this._progress.raiseEvent(progress);
        });

        promise.then(
            (updatedTrianglePositions) => {
                this._doComputeCutVolume(updatedTrianglePositions, minHeight);
            },
            () => {
                alert("Something went wrong!");
            }
        );

        promise.catch((error) => {
            if (error) {
                console.error(error);
            }
        });
    }

    _updatePositions(positions, progressCallback) {
        return new Promise((resolve, reject) => {
            const division = 100;
            const progressStep = 1 / division;

            const countPerStep = Math.ceil(positions.length / division);
            let partialPromise = null;

            const scene = this._scene;

            const updatedPositions = [];
            let progress = 0;

            for (let i = 0; i < positions.length; i += countPerStep) {
                const progressStepsPositions = positions.slice(i, i + countPerStep);

                if (!partialPromise) {
                    partialPromise = scene.clampToHeightMostDetailed(progressStepsPositions).then(clampedPositions => {
                        clampedPositions.forEach(position => {
                            updatedPositions.push(position);
                        });

                        progress += progressStep;
                        progressCallback(progress);
                    });
                } else {
                    partialPromise = partialPromise.then(() => {
                        if (this._canceled) {
                            reject();
                        } else {
                            return scene.clampToHeightMostDetailed(progressStepsPositions).then(clampedPositions => {
                                clampedPositions.forEach(position => {
                                    updatedPositions.push(position);
                                });

                                progress += progressStep;
                                progressCallback(progress);
                            });
                        }
                    });
                }
            }

            partialPromise.then(() => {
                if (this._canceled) {
                    reject();
                } else {
                    progressCallback(1);

                    resolve(updatedPositions);
                }
            });
        })
    }

    _doComputeCutVolume(trianglesPositions, minHeight) {
        const count = trianglesPositions.length / 3;
        const scratchCartographic = new Cartographic();
        let maxHeight = 0;
        let totalCutVolume = 0;

        for (let i = 0; i < count; i++) {
            const p1 = trianglesPositions[i * 3];
            let cartographic = Cartographic.fromCartesian(p1, Ellipsoid.WGS84, scratchCartographic);
            const bottomP1 = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
            const height1 = cartographic.height;

            if (maxHeight < height1)
                maxHeight = height1;

            const p2 = trianglesPositions[i * 3 + 1];
            cartographic = Cartographic.fromCartesian(p2, Ellipsoid.WGS84, scratchCartographic);
            const bottomP2 = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
            const height2 = cartographic.height;

            if (maxHeight < height2)
                maxHeight = height2;

            const p3 = trianglesPositions[i * 3 + 2];
            cartographic = Cartographic.fromCartesian(p3, Ellipsoid.WGS84, scratchCartographic);
            const bottomP3 = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
            const height3 = cartographic.height;

            if (maxHeight < height3)
                maxHeight = height3;

            const bottomArea = computeAreaOfTriangle(bottomP1, bottomP2, bottomP3);
            const height = (height1 + height2 + height3 - 3 * minHeight) / 3;

            totalCutVolume = totalCutVolume + bottomArea * height;
        }

        const centroid = computeCentroidOfPolygon(this._positions);

        this._labelCollection.add({
            position: Cartesian3.fromRadians(centroid.longitude, centroid.latitude, maxHeight + 1000),
            text: `${totalCutVolume.toFixed(2)}㎥`,
            font: "15pt Lucida Console",
            horizontalOrigin: HorizontalOrigin.LEFT,
            verticalOrigin: VerticalOrigin.CENTER,
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            pixelOffset: new Cartesian2(6, -4)
        });

        this._drawFillMesh(trianglesPositions, minHeight, maxHeight);
        this._drawWireframeOfTopTriangles(trianglesPositions);
    }

    _getColorByHeight(heightDiff, maxHeightDiff) {
        let ratio = heightDiff / maxHeightDiff;
        ratio = CesiumMath.clamp(ratio, 0, 1);

        return Color.lerp(Color.BLUE.withAlpha(1.0), Color.RED.withAlpha(1.0), ratio, new Color());
    }

    _drawFillMesh(trianglesPositions, minHeight, maxHeight) {
        const indices = [];
        const colors = [];

        const positions = [];
        const triangleCount = trianglesPositions.length / 3;

        // const triangleCount = 1;

        const heightDiff = maxHeight - minHeight;

        for (let i = 0; i < triangleCount; i++) {
            const topVertex1 = trianglesPositions[i * 3];
            const topVertex2 = trianglesPositions[i * 3 + 1];
            const topVertex3 = trianglesPositions[i * 3 + 2];

            const topVertex1Cartographic = Cartographic.fromCartesian(topVertex1, Ellipsoid.WGS84, new Cartographic());
            const topVertex2Cartographic = Cartographic.fromCartesian(topVertex2, Ellipsoid.WGS84, new Cartographic());
            const topVertex3Cartographic = Cartographic.fromCartesian(topVertex3, Ellipsoid.WGS84, new Cartographic());

            const bottomVertex1 = Cartesian3.fromRadians(topVertex1Cartographic.longitude, topVertex1Cartographic.latitude, minHeight);
            const bottomVertex2 = Cartesian3.fromRadians(topVertex2Cartographic.longitude, topVertex2Cartographic.latitude, minHeight);
            const bottomVertex3 = Cartesian3.fromRadians(topVertex3Cartographic.longitude, topVertex3Cartographic.latitude, minHeight);

            positions.push(topVertex1, topVertex2, topVertex3, bottomVertex1, bottomVertex2, bottomVertex3);

            const base = i * 6;

            // draw top triangle
            indices.push(base, base + 1, base + 2);

            indices.push(base, base + 1, base + 3);
            indices.push(base + 1, base + 4, base + 3);

            indices.push(base + 1, base + 2, base + 4);
            indices.push(base + 2, base + 5, base + 4);

            indices.push(base, base + 2, base + 3);
            indices.push(base + 2, base + 5, base + 3);

            colors.push(this._getColorByHeight(topVertex1Cartographic.height - minHeight, heightDiff));
            colors.push(this._getColorByHeight(topVertex2Cartographic.height - minHeight, heightDiff));
            colors.push(this._getColorByHeight(topVertex3Cartographic.height - minHeight, heightDiff));

            colors.push(Color.BLUE);
            colors.push(Color.BLUE);
            colors.push(Color.BLUE);
        }

        const positionBuffer = new Float64Array(Cartesian3.packArray(positions, []));
        const colorsByte = [];

        colors.forEach((color) => {
            const bytes = [];
            color.toBytes(bytes);

            bytes.forEach((byte) => {
                colorsByte.push(byte);
            });
        });

        const colorBuffer = new Uint8Array(colorsByte);

        const boundingSphere = BoundingSphere.fromVertices(positionBuffer);
        const geometry = new Geometry({
            attributes: {
                position: new GeometryAttribute({
                    componentDatatype: ComponentDatatype.DOUBLE,
                    componentsPerAttribute: 3,
                    values: positionBuffer
                }),
                color: new GeometryAttribute({
                    componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
                    componentsPerAttribute: 4,
                    values: colorBuffer,
                    normalize: true
                })
            },
            indices: new Uint16Array(indices),
            // primitiveType: PrimitiveType.LINES,
            primitiveType: PrimitiveType.TRIANGLES,
            boundingSphere: boundingSphere
        });

        this._centerOfFillMesh = boundingSphere.center;

        GeometryPipeline.computeNormal(geometry);

        const instance = new GeometryInstance({
            geometry: geometry
        });

        const toWorld = Transforms.eastNorthUpToFixedFrame(this._centerOfFillMesh);
        const invWorld = Matrix4.inverseTransformation(toWorld, new Matrix4());
        const translation = Matrix4.fromTranslation(new Cartesian3(0, 0, this._verticalOffset), new Matrix4());

        const modelMatrix = toWorld;
        Matrix4.multiply(modelMatrix, translation, modelMatrix);
        Matrix4.multiply(modelMatrix, invWorld, modelMatrix);

        const primitive = new Primitive({
            geometryInstances: instance,
            appearance: new PerInstanceColorAppearance({
                translucent: true,
                flat: true
            }),
            asynchronous: false,
            releaseGeometryInstances: true,
            modelMatrix: modelMatrix
        });

        this._scene.primitives.add(primitive);

        this._primitiveFillMesh = primitive;
    }

    _drawWireframeOfTopTriangles(trianglesPositions) {
        const indices = [];
        const colors = [];

        const positions = [];
        const triangleCount = trianglesPositions.length / 3;

        for (let i = 0; i < triangleCount; i++) {
            const topVertex1 = trianglesPositions[i * 3];
            const topVertex2 = trianglesPositions[i * 3 + 1];
            const topVertex3 = trianglesPositions[i * 3 + 2];

            positions.push(topVertex1, topVertex2, topVertex3);

            const base = i * 3;

            // draw top triangle
            indices.push(base, base + 1, base + 2);

            colors.push(Color.WHITE, Color.WHITE, Color.WHITE);
        }

        const positionBuffer = new Float64Array(Cartesian3.packArray(positions, []));
        const colorsByte = [];

        colors.forEach((color) => {
            const bytes = [];
            color.toBytes(bytes);

            bytes.forEach((byte) => {
                colorsByte.push(byte);
            });
        });

        const colorBuffer = new Uint8Array(colorsByte);

        const boundingSphere = BoundingSphere.fromVertices(positionBuffer);
        const geometry = new Geometry({
            attributes: {
                position: new GeometryAttribute({
                    componentDatatype: ComponentDatatype.DOUBLE,
                    componentsPerAttribute: 3,
                    values: positionBuffer
                }),
                color: new GeometryAttribute({
                    componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
                    componentsPerAttribute: 4,
                    values: colorBuffer,
                    normalize: true
                })
            },
            indices: new Uint16Array(indices),
            primitiveType: PrimitiveType.LINES,
            boundingSphere: boundingSphere
        });

        this._centerOfWireframe = boundingSphere.center;

        GeometryPipeline.computeNormal(geometry);

        const instance = new GeometryInstance({
            geometry: geometry
        });

        const toWorld = Transforms.eastNorthUpToFixedFrame(this._centerOfWireframe);
        const invWorld = Matrix4.inverseTransformation(toWorld, new Matrix4());
        const translation = Matrix4.fromTranslation(new Cartesian3(0, 0, this._verticalOffset), new Matrix4());

        const modelMatrix = toWorld;
        Matrix4.multiply(modelMatrix, translation, modelMatrix);
        Matrix4.multiply(modelMatrix, invWorld, modelMatrix);

        const primitive = new Primitive({
            geometryInstances: instance,
            appearance: new PerInstanceColorAppearance({
                translucent: true,
                flat: true
            }),
            asynchronous: false,
            releaseGeometryInstances: true,
            modelMatrix: modelMatrix
        });

        this._scene.primitives.add(primitive);

        this._primitiveWireframe = primitive;
    }

    cleanUp() {
        if (this._mouseHandler !== undefined) {
            this._mouseHandler.destroy();
            this._mouseHandler = undefined;
        }

        if (this._markers !== undefined) {
            this._markers.destroy();
            this._markers = undefined;
        }

        if (this._primitiveFillMesh) {
            this._scene.primitives.remove(this._primitiveFillMesh);
            this._primitiveFillMesh = undefined;
        }

        if (this._primitiveWireframe) {
            this._scene.primitives.remove(this._primitiveWireframe);
            this._primitiveWireframe = undefined;
        }

        this._labelCollection.removeAll();

        this._tooltip.setVisible(false);

        this._positions = [];
        this._polyline.positions = [];
        this._polygon.positions = [];
    }

    get clonedPositions() {
        const positions = [];

        this._positions.forEach(position => {
            positions.push(position.clone(new Cartesian3()));
        });

        return positions;
    }

    get granularity() {
        return this._granularity;
    }

    set granularity(val) {
        this._granularity = parseInt(val);

        if (this._primitiveFillMesh) {
            this._scene.primitives.remove(this._primitiveFillMesh);
            this._primitiveFillMesh = undefined;
        }

        if (this._primitiveWireframe) {
            this._scene.primitives.remove(this._primitiveWireframe);
            this._primitiveWireframe = undefined;
        }

        this._labelCollection.removeAll();
        this._tooltip.setVisible(false);

        this.computeCutVolume();
    }

    get verticalOffset() {
        return this._verticalOffset;
    }

    set verticalOffset(val) {
        this._verticalOffset = val;

        if (this._primitiveFillMesh) {
            const toWorld = Transforms.eastNorthUpToFixedFrame(this._centerOfFillMesh);
            const invWorld = Matrix4.inverseTransformation(toWorld, new Matrix4());
            const translation = Matrix4.fromTranslation(new Cartesian3(0, 0, this._verticalOffset), new Matrix4());

            const modelMatrix = toWorld;

            Matrix4.multiply(modelMatrix, translation, modelMatrix);
            Matrix4.multiply(modelMatrix, invWorld, modelMatrix);

            this._primitiveFillMesh.modelMatrix = modelMatrix;
        }

        if (this._primitiveWireframe) {
            const toWorld = Transforms.eastNorthUpToFixedFrame(this._centerOfWireframe);
            const invWorld = Matrix4.inverseTransformation(toWorld, new Matrix4());
            const translation = Matrix4.fromTranslation(new Cartesian3(0, 0, this._verticalOffset), new Matrix4());

            const modelMatrix = toWorld;

            Matrix4.multiply(modelMatrix, translation, modelMatrix);
            Matrix4.multiply(modelMatrix, invWorld, modelMatrix);

            this._primitiveWireframe.modelMatrix = modelMatrix;
        }
    }

    get progress() {
        return this._progress;
    }
}