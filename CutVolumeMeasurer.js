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

const scratchCartographic = new Cartographic();
const scratchBottom1 = new Cartesian3();
const scratchBottom2 = new Cartesian3();
const scratchBottom3 = new Cartesian3();
const scratchMeshBottom1 = new Cartesian3();
const scratchMeshBottom2 = new Cartesian3();
const scratchMeshBottom3 = new Cartesian3();
const scratchEdge1 = new Cartesian3();
const scratchEdge2 = new Cartesian3();
const scratchCross = new Cartesian3();

function computeAreaOfTriangle(pos1, pos2, pos3) {
    Cartesian3.subtract(pos2, pos1, scratchEdge1);
    Cartesian3.subtract(pos3, pos1, scratchEdge2);
    Cartesian3.cross(scratchEdge1, scratchEdge2, scratchCross);
    return Cartesian3.magnitude(scratchCross) * 0.5;
}

function writeHeightColor(buffer, offset, heightAboveMin, invHeightDiff) {
    const ratio = CesiumMath.clamp(heightAboveMin * invHeightDiff, 0, 1);
    buffer[offset] = Math.round(ratio * 255);
    buffer[offset + 1] = 0;
    buffer[offset + 2] = Math.round((1 - ratio) * 255);
    buffer[offset + 3] = 255;
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
                const firstPointScreenPosition = SceneTransforms.worldToWindowCoordinates(scene, positions[0]);

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
                        clampedPositions.forEach((position, index) => {
                            updatedPositions.push(position ?? progressStepsPositions[index]);
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
                                clampedPositions.forEach((position, index) => {
                                    updatedPositions.push(position ?? progressStepsPositions[index]);
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
        const triangleCount = trianglesPositions.length / 3;
        const vertexCount = triangleCount * 3;
        const longitudes = new Float64Array(vertexCount);
        const latitudes = new Float64Array(vertexCount);
        const heights = new Float64Array(vertexCount);

        const minHeight3 = minHeight * 3;
        let maxHeight = 0;
        let totalCutVolume = 0;

        for (let i = 0; i < vertexCount; i++) {
            const cartographic = Cartographic.fromCartesian(
                trianglesPositions[i],
                Ellipsoid.WGS84,
                scratchCartographic
            );

            longitudes[i] = cartographic.longitude;
            latitudes[i] = cartographic.latitude;
            heights[i] = cartographic.height;

            if (maxHeight < cartographic.height) {
                maxHeight = cartographic.height;
            }
        }

        for (let i = 0; i < triangleCount; i++) {
            const i3 = i * 3;

            Cartesian3.fromRadians(longitudes[i3], latitudes[i3], 0, Ellipsoid.WGS84, scratchBottom1);
            Cartesian3.fromRadians(longitudes[i3 + 1], latitudes[i3 + 1], 0, Ellipsoid.WGS84, scratchBottom2);
            Cartesian3.fromRadians(longitudes[i3 + 2], latitudes[i3 + 2], 0, Ellipsoid.WGS84, scratchBottom3);

            const bottomArea = computeAreaOfTriangle(scratchBottom1, scratchBottom2, scratchBottom3);
            totalCutVolume += bottomArea * ((heights[i3] + heights[i3 + 1] + heights[i3 + 2] - minHeight3) / 3);
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

        this._buildVisualizationMeshes(trianglesPositions, longitudes, latitudes, heights, minHeight, maxHeight);
    }

    _buildVisualizationMeshes(trianglesPositions, longitudes, latitudes, heights, minHeight, maxHeight) {
        const triangleCount = trianglesPositions.length / 3;
        const invHeightDiff = maxHeight > minHeight ? 1 / (maxHeight - minHeight) : 0;

        const fillPositionBuffer = new Float64Array(triangleCount * 18);
        const fillColorBuffer = new Uint8Array(triangleCount * 24);
        const fillIndices = new Uint16Array(triangleCount * 24);

        const wirePositionBuffer = new Float64Array(triangleCount * 9);
        const wireColorBuffer = new Uint8Array(triangleCount * 12);
        const wireIndices = new Uint16Array(triangleCount * 3);

        let fillPositionOffset = 0;
        let fillColorOffset = 0;
        let fillIndexOffset = 0;
        let wirePositionOffset = 0;
        let wireColorOffset = 0;
        let wireIndexOffset = 0;

        for (let i = 0; i < triangleCount; i++) {
            const i3 = i * 3;
            const topVertex1 = trianglesPositions[i3];
            const topVertex2 = trianglesPositions[i3 + 1];
            const topVertex3 = trianglesPositions[i3 + 2];

            const bottomVertex1 = Cartesian3.fromRadians(longitudes[i3], latitudes[i3], minHeight, Ellipsoid.WGS84, scratchMeshBottom1);
            const bottomVertex2 = Cartesian3.fromRadians(longitudes[i3 + 1], latitudes[i3 + 1], minHeight, Ellipsoid.WGS84, scratchMeshBottom2);
            const bottomVertex3 = Cartesian3.fromRadians(longitudes[i3 + 2], latitudes[i3 + 2], minHeight, Ellipsoid.WGS84, scratchMeshBottom3);

            fillPositionBuffer[fillPositionOffset++] = topVertex1.x;
            fillPositionBuffer[fillPositionOffset++] = topVertex1.y;
            fillPositionBuffer[fillPositionOffset++] = topVertex1.z;
            fillPositionBuffer[fillPositionOffset++] = topVertex2.x;
            fillPositionBuffer[fillPositionOffset++] = topVertex2.y;
            fillPositionBuffer[fillPositionOffset++] = topVertex2.z;
            fillPositionBuffer[fillPositionOffset++] = topVertex3.x;
            fillPositionBuffer[fillPositionOffset++] = topVertex3.y;
            fillPositionBuffer[fillPositionOffset++] = topVertex3.z;
            fillPositionBuffer[fillPositionOffset++] = bottomVertex1.x;
            fillPositionBuffer[fillPositionOffset++] = bottomVertex1.y;
            fillPositionBuffer[fillPositionOffset++] = bottomVertex1.z;
            fillPositionBuffer[fillPositionOffset++] = bottomVertex2.x;
            fillPositionBuffer[fillPositionOffset++] = bottomVertex2.y;
            fillPositionBuffer[fillPositionOffset++] = bottomVertex2.z;
            fillPositionBuffer[fillPositionOffset++] = bottomVertex3.x;
            fillPositionBuffer[fillPositionOffset++] = bottomVertex3.y;
            fillPositionBuffer[fillPositionOffset++] = bottomVertex3.z;

            writeHeightColor(fillColorBuffer, fillColorOffset, heights[i3] - minHeight, invHeightDiff);
            fillColorOffset += 4;
            writeHeightColor(fillColorBuffer, fillColorOffset, heights[i3 + 1] - minHeight, invHeightDiff);
            fillColorOffset += 4;
            writeHeightColor(fillColorBuffer, fillColorOffset, heights[i3 + 2] - minHeight, invHeightDiff);
            fillColorOffset += 4;
            fillColorBuffer[fillColorOffset++] = 0;
            fillColorBuffer[fillColorOffset++] = 0;
            fillColorBuffer[fillColorOffset++] = 255;
            fillColorBuffer[fillColorOffset++] = 255;
            fillColorBuffer[fillColorOffset++] = 0;
            fillColorBuffer[fillColorOffset++] = 0;
            fillColorBuffer[fillColorOffset++] = 255;
            fillColorBuffer[fillColorOffset++] = 255;
            fillColorBuffer[fillColorOffset++] = 0;
            fillColorBuffer[fillColorOffset++] = 0;
            fillColorBuffer[fillColorOffset++] = 255;
            fillColorBuffer[fillColorOffset++] = 255;

            const base = i * 6;
            fillIndices[fillIndexOffset++] = base;
            fillIndices[fillIndexOffset++] = base + 1;
            fillIndices[fillIndexOffset++] = base + 2;
            fillIndices[fillIndexOffset++] = base;
            fillIndices[fillIndexOffset++] = base + 1;
            fillIndices[fillIndexOffset++] = base + 3;
            fillIndices[fillIndexOffset++] = base + 1;
            fillIndices[fillIndexOffset++] = base + 4;
            fillIndices[fillIndexOffset++] = base + 3;
            fillIndices[fillIndexOffset++] = base + 1;
            fillIndices[fillIndexOffset++] = base + 2;
            fillIndices[fillIndexOffset++] = base + 4;
            fillIndices[fillIndexOffset++] = base + 2;
            fillIndices[fillIndexOffset++] = base + 5;
            fillIndices[fillIndexOffset++] = base + 4;
            fillIndices[fillIndexOffset++] = base;
            fillIndices[fillIndexOffset++] = base + 2;
            fillIndices[fillIndexOffset++] = base + 3;
            fillIndices[fillIndexOffset++] = base + 2;
            fillIndices[fillIndexOffset++] = base + 5;
            fillIndices[fillIndexOffset++] = base + 3;

            wirePositionBuffer[wirePositionOffset++] = topVertex1.x;
            wirePositionBuffer[wirePositionOffset++] = topVertex1.y;
            wirePositionBuffer[wirePositionOffset++] = topVertex1.z;
            wirePositionBuffer[wirePositionOffset++] = topVertex2.x;
            wirePositionBuffer[wirePositionOffset++] = topVertex2.y;
            wirePositionBuffer[wirePositionOffset++] = topVertex2.z;
            wirePositionBuffer[wirePositionOffset++] = topVertex3.x;
            wirePositionBuffer[wirePositionOffset++] = topVertex3.y;
            wirePositionBuffer[wirePositionOffset++] = topVertex3.z;

            wireColorBuffer[wireColorOffset++] = 255;
            wireColorBuffer[wireColorOffset++] = 255;
            wireColorBuffer[wireColorOffset++] = 255;
            wireColorBuffer[wireColorOffset++] = 255;
            wireColorBuffer[wireColorOffset++] = 255;
            wireColorBuffer[wireColorOffset++] = 255;
            wireColorBuffer[wireColorOffset++] = 255;
            wireColorBuffer[wireColorOffset++] = 255;
            wireColorBuffer[wireColorOffset++] = 255;
            wireColorBuffer[wireColorOffset++] = 255;
            wireColorBuffer[wireColorOffset++] = 255;
            wireColorBuffer[wireColorOffset++] = 255;

            const wireBase = i * 3;
            wireIndices[wireIndexOffset++] = wireBase;
            wireIndices[wireIndexOffset++] = wireBase + 1;
            wireIndices[wireIndexOffset++] = wireBase + 2;
        }

        const fillBoundingSphere = BoundingSphere.fromVertices(fillPositionBuffer);
        const fillGeometry = new Geometry({
            attributes: {
                position: new GeometryAttribute({
                    componentDatatype: ComponentDatatype.DOUBLE,
                    componentsPerAttribute: 3,
                    values: fillPositionBuffer
                }),
                color: new GeometryAttribute({
                    componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
                    componentsPerAttribute: 4,
                    values: fillColorBuffer,
                    normalize: true
                })
            },
            indices: fillIndices,
            primitiveType: PrimitiveType.TRIANGLES,
            boundingSphere: fillBoundingSphere
        });

        this._centerOfFillMesh = fillBoundingSphere.center;
        GeometryPipeline.computeNormal(fillGeometry);

        this._primitiveFillMesh = this._createColoredPrimitive(
            fillGeometry,
            fillBoundingSphere.center
        );
        this._scene.primitives.add(this._primitiveFillMesh);

        const wireBoundingSphere = BoundingSphere.fromVertices(wirePositionBuffer);
        const wireGeometry = new Geometry({
            attributes: {
                position: new GeometryAttribute({
                    componentDatatype: ComponentDatatype.DOUBLE,
                    componentsPerAttribute: 3,
                    values: wirePositionBuffer
                }),
                color: new GeometryAttribute({
                    componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
                    componentsPerAttribute: 4,
                    values: wireColorBuffer,
                    normalize: true
                })
            },
            indices: wireIndices,
            primitiveType: PrimitiveType.LINES,
            boundingSphere: wireBoundingSphere
        });

        this._centerOfWireframe = wireBoundingSphere.center;
        GeometryPipeline.computeNormal(wireGeometry);

        this._primitiveWireframe = this._createColoredPrimitive(
            wireGeometry,
            wireBoundingSphere.center
        );
        this._scene.primitives.add(this._primitiveWireframe);
    }

    _createColoredPrimitive(geometry, center) {
        const toWorld = Transforms.eastNorthUpToFixedFrame(center);
        const invWorld = Matrix4.inverseTransformation(toWorld, new Matrix4());
        const translation = Matrix4.fromTranslation(new Cartesian3(0, 0, this._verticalOffset), new Matrix4());
        const modelMatrix = Matrix4.multiply(
            toWorld,
            Matrix4.multiply(translation, invWorld, new Matrix4()),
            new Matrix4()
        );

        return new Primitive({
            geometryInstances: new GeometryInstance({
                geometry: geometry
            }),
            appearance: new PerInstanceColorAppearance({
                translucent: true,
                flat: true
            }),
            asynchronous: false,
            releaseGeometryInstances: true,
            modelMatrix: modelMatrix
        });
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