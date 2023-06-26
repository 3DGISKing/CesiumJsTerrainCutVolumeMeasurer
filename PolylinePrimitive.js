const {
    ArcType,
    BoundingSphere,
    Color,
    ColorGeometryInstanceAttribute,
    CoplanarPolygonGeometry,
    createGuid,
    defaultValue,
    defined,
    destroyObject,
    Ellipsoid,
    GeometryInstance,
    GroundPolylineGeometry,
    GroundPolylinePrimitive,
    Material,
    PerInstanceColorAppearance,
    PolylineColorAppearance,
    PolylineGeometry,
    PolylineMaterialAppearance,
    Primitive

} = window.Cesium;

export default function PolylinePrimitive(options) {
    options = defaultValue(options, defaultValue.EMPTY_OBJECT);

    this.show = defaultValue(options.show, true);
    this._ellipsoid = defaultValue(options.ellipsoid, Ellipsoid.WGS84);
    this._width = defaultValue(options.width, 3);
    this._color = Color.clone(defaultValue(options.color, Color.WHITE));
    this._id = createGuid();
    this._positions = defaultValue(options.positions, []);
    this._primitive = undefined;
    this._boundingSphere = new BoundingSphere();
    this._dashed = defaultValue(options.dashed, false);
    this._loop = defaultValue(options.loop, false);
    this._depthTest = defaultValue(options.depthTest, true);
    this._clampToGround = defaultValue(options.clampToGround, true);
    this._update = true;
}

Object.defineProperties(PolylinePrimitive.prototype, {
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
    },
    width: {
        get: function () {
            return this._width;
        }
    },
    ellipsoid: {
        get: function () {
            return this._ellipsoid;
        }
    },
    dashed: {
        get: function () {
            return this._dashed;
        }
    },
    loop: {
        get: function () {
            return this._loop;
        }
    }
});

PolylinePrimitive.prototype.update = function (frameState) {
    if (!this.show) {
        return;
    }

    let positions = this._positions;

    if (!defined(positions) || positions.length < 2) {
        this._primitive = this._primitive && this._primitive.destroy();
        return;
    }

    if (this._update) {
        this._update = false;

        this._primitive = this._primitive && this._primitive.destroy();

        if (this._loop) {
            positions = positions.slice();
            positions.push(positions[0]);
        }

        let appearance;

        if (this._dashed) {
            appearance = new PolylineMaterialAppearance({
                material: Material.fromType(Material.PolylineDashType, {
                    color: this._color
                })
            });
        } else {
            appearance = new PolylineColorAppearance();
        }

        if (this._clampToGround) {
            const geometry = new GroundPolylineGeometry({
                positions: positions,
                width: this._width,
                vertexFormat: PolylineMaterialAppearance.VERTEX_FORMAT,
                ellipsoid: this._ellipsoid,
                arcType: ArcType.GEODESIC
            });

            this._primitive = new GroundPolylinePrimitive({
                geometryInstances: new GeometryInstance({
                    geometry: geometry,
                    attributes: {
                        color: ColorGeometryInstanceAttribute.fromColor(this._color),
                        depthFailColor: ColorGeometryInstanceAttribute.fromColor(this._color)
                    }
                }),
                appearance: appearance,
                depthFailAppearance: this._depthTest ? undefined : appearance,
                asynchronous: false,
                allowPicking: false
            });
        } else {
            const geometry = new PolylineGeometry({
                positions: positions,
                width: this.width,
                vertexFormat: PolylineMaterialAppearance.VERTEX_FORMAT,
                ellipsoid: this._ellipsoid,
                arcType: ArcType.NONE
            });

            this._primitive = new Primitive({
                geometryInstances: new GeometryInstance({
                    geometry: geometry,
                    attributes: {
                        color: ColorGeometryInstanceAttribute.fromColor(this._color),
                        depthFailColor: ColorGeometryInstanceAttribute.fromColor(this._color)
                    }
                }),
                appearance: appearance,
                depthFailAppearance: this._depthTest ? undefined : appearance,
                asynchronous: false,
                allowPicking: false
            });
        }

        this._boundingSphere = BoundingSphere.fromPoints(positions, this._boundingSphere);
    }

    this._primitive.update(frameState);
};

PolylinePrimitive.prototype.isDestroyed = function () {
    return false;
};

PolylinePrimitive.prototype.destroy = function () {
    this._primitive = this._primitive && this._primitive.destroy();
    return destroyObject(this);
};