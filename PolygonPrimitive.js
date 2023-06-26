const {
    BoundingSphere,
    Color,
    ColorGeometryInstanceAttribute,
    CoplanarPolygonGeometry,
    createGuid,
    defaultValue,
    destroyObject,
    GeometryInstance,
    GroundPrimitive,
    PerInstanceColorAppearance,
    PolygonGeometry,
    PolygonHierarchy,
    Primitive
} = window.Cesium;

export default function PolygonPrimitive(options) {
    options = defaultValue(options, defaultValue.EMPTY_OBJECT);

    this.show = defaultValue(options.show, true);
    const color = Color.clone(defaultValue(options.color, Color.WHITE));
    this._id = createGuid();
    this._color = color;
    this._depthFailColor = color;
    this._positions = defaultValue(options.positions, []);
    this._boundingSphere = new BoundingSphere();
    this._primitive = undefined;
    this._depthTest = defaultValue(options.depthTest, true);
    this._clampToGround = defaultValue(options.clampToGround, true);
    this._update = true;
}

Object.defineProperties(PolygonPrimitive.prototype, {
    positions: {
        get: function () {
            return this._positions;
        },
        set: function (positions) {
            this._positions = positions;
            this._update = true;
        }
    },
    color: {
        get: function () {
            return this._color;
        }
    },
    boundingVolume: {
        get: function () {
            return this._boundingSphere;
        }
    }
});

PolygonPrimitive.prototype.update = function (frameState) {
    if (!this.show) {
        return;
    }

    const positions = this._positions;

    if (positions.length < 3) {
        this._primitive = this._primitive && this._primitive.destroy();
        return;
    }

    if (this._update) {
        this._update = false;

        this._primitive = this._primitive && this._primitive.destroy();

        const appearance = new PerInstanceColorAppearance({
            flat: true,
            closed: false,
            translucent: this._color.alpha < 1.0
        });

        if (this._clampToGround) {
            const geometry = new PolygonGeometry({
                polygonHierarchy: new PolygonHierarchy(positions),
                perPositionHeight: true
            });

            this._primitive = new GroundPrimitive({
                geometryInstances: new GeometryInstance({
                    geometry: geometry,
                    attributes: {
                        color: ColorGeometryInstanceAttribute.fromColor(this._color),
                        depthFailColor: ColorGeometryInstanceAttribute.fromColor(this._depthFailColor)
                    }
                }),
                appearance: appearance,
                depthFailAppearance: this._depthTest ? undefined : appearance,
                allowPicking: false,
                asynchronous: false
            });
        } else {
            const geometry = CoplanarPolygonGeometry.fromPositions({
                positions: positions,
                vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT
            });

            this._primitive = new Primitive({
                geometryInstances: new GeometryInstance({
                    geometry: geometry,
                    attributes: {
                        color: ColorGeometryInstanceAttribute.fromColor(this._color),
                        depthFailColor: ColorGeometryInstanceAttribute.fromColor(this._depthFailColor)
                    }
                }),
                appearance: appearance,
                depthFailAppearance: this._depthTest ? undefined : appearance,
                allowPicking: false,
                asynchronous: false
            });
        }

        this._boundingSphere = BoundingSphere.fromPoints(positions, this._boundingSphere);
    }

    this._primitive.update(frameState);
};

PolygonPrimitive.prototype.isDestroyed = function () {
    return false;
};

PolygonPrimitive.prototype.destroy = function () {
    this._primitive = this._primitive && this._primitive.destroy();
    return destroyObject(this);
};