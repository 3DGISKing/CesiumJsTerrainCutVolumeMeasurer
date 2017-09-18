
var CesiumMeasurer = (function () {
    // static variables
    var ellipsoid = Cesium.Ellipsoid.WGS84;

    //constructor
    function _(cesiumWidget) {
        this._scene = cesiumWidget.scene;
        this._tooltip = createTooltip(cesiumWidget.container);
        this._cesiumViewer = cesiumWidget;
    }

    function clone(from, to) {
        if (from == null || typeof from != "object") return from;
        if (from.constructor != Object && from.constructor != Array) return from;
        if (from.constructor == Date || from.constructor == RegExp || from.constructor == Function ||
            from.constructor == String || from.constructor == Number || from.constructor == Boolean)
            return new from.constructor(from);

        to = to || new from.constructor();

        for (var name in from) {
            to[name] = typeof to[name] == "undefined" ? clone(from[name], null) : to[name];
        }

        return to;
    }

    // shallow copy
    function copyOptions(options, defaultOptions) {
        var newOptions = clone(options), option;
        for(option in defaultOptions) {
            if(newOptions[option] === undefined) {
                newOptions[option] = clone(defaultOptions[option]);
            }
        }
        return newOptions;
    }

    function fillOptions(options, defaultOptions) {
        options = options || {};
        var option;
        for(option in defaultOptions) {
            if(options[option] === undefined) {
                options[option] = clone(defaultOptions[option]);
            }
        }
    }

    function createTooltip(frameDiv) {

        var tooltip = function(frameDiv) {

            var div = document.createElement('DIV');
            div.className = "twipsy right";

            var arrow = document.createElement('DIV');
            arrow.className = "twipsy-arrow";
            div.appendChild(arrow);

            var title = document.createElement('DIV');
            title.className = "twipsy-inner";
            div.appendChild(title);

            this._div = div;
            this._title = title;

            // add to frame div and display coordinates
            frameDiv.appendChild(div);
        }

        tooltip.prototype.setVisible = function(visible) {
            this._div.style.display = visible ? 'block' : 'none';
        }

        tooltip.prototype.showAt = function(position, message) {
            if(position && message) {
                this.setVisible(true);
                this._title.innerHTML = message;
                this._div.style.left = position.x + 10 + "px";
                this._div.style.top = (position.y - this._div.clientHeight / 2) + "px";
            }
        }

        return new tooltip(frameDiv);
    }

    _.prototype.addToolbar = function (container, options ) {
        options = copyOptions(options, {container: container});
        return new _.Toolbar(this, options);
    }


    var defaultBillboard = {
        iconUrl: "./img/dragIcon.png",
        shiftX: 0,
        shiftY: 0
    }

    _.prototype.createBillboardGroup = function(points, options, callbacks) {
        var markers = new _.BillboardGroup(this, options);
        markers.addBillboards(points, callbacks);
        return markers;
    }

    _.BillboardGroup = function(drawHelper, options) {

        this._drawHelper = drawHelper;
        this._scene = drawHelper._scene;

        this._options = copyOptions(options, defaultBillboard);

        // create one common billboard collection for all billboards
        var b = new Cesium.BillboardCollection();
        this._scene.primitives.add(b);
        this._billboards = b;
        // keep an ordered list of billboards
        this._orderedBillboards = [];
    }

    _.BillboardGroup.prototype.createBillboard = function(position, callbacks) {

        var billboard = this._billboards.add({
            show : true,
            position : position,
            pixelOffset : new Cesium.Cartesian2(this._options.shiftX, this._options.shiftY),
            eyeOffset : new Cesium.Cartesian3(0.0, 0.0, -1000.0),
            horizontalOrigin : Cesium.HorizontalOrigin.CENTER,
            verticalOrigin : Cesium.VerticalOrigin.CENTER,
            scale : 1.0,
            image: this._options.iconUrl,
            color : new Cesium.Color(1.0, 1.0, 1.0, 1.0)
        });

        // if editable
        if(callbacks) {
            var _self = this;
            var screenSpaceCameraController = this._scene.screenSpaceCameraController;
            function enableRotation(enable) {
                screenSpaceCameraController.enableRotate = enable;
            }
            function getIndex() {
                // find index
                for (var i = 0, I = _self._orderedBillboards.length; i < I && _self._orderedBillboards[i] != billboard; ++i);
                return i;
            }
            if(callbacks.dragHandlers) {
                var _self = this;
                setListener(billboard, 'leftDown', function(position) {
                    // TODO - start the drag handlers here
                    // create handlers for mouseOut and leftUp for the billboard and a mouseMove
                    function onDrag(position) {
                        billboard.position = position;
                        // find index
                        for (var i = 0, I = _self._orderedBillboards.length; i < I && _self._orderedBillboards[i] != billboard; ++i);
                        callbacks.dragHandlers.onDrag && callbacks.dragHandlers.onDrag(getIndex(), position);
                    }
                    function onDragEnd(position) {
                        handler.destroy();
                        enableRotation(true);
                        callbacks.dragHandlers.onDragEnd && callbacks.dragHandlers.onDragEnd(getIndex(), position);
                    }

                    var handler = new Cesium.ScreenSpaceEventHandler(_self._scene.canvas);

                    handler.setInputAction(function(movement) {
                        var cartesian = _self._scene.camera.pickEllipsoid(movement.endPosition, ellipsoid);
                        if (cartesian) {
                            onDrag(cartesian);
                        } else {
                            onDragEnd(cartesian);
                        }
                    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

                    handler.setInputAction(function(movement) {
                        onDragEnd(_self._scene.camera.pickEllipsoid(movement.position, ellipsoid));
                    }, Cesium.ScreenSpaceEventType.LEFT_UP);

                    enableRotation(false);

                    callbacks.dragHandlers.onDragStart && callbacks.dragHandlers.onDragStart(getIndex(), _self._scene.camera.pickEllipsoid(position, ellipsoid));
                });
            }
            if(callbacks.onDoubleClick) {
                setListener(billboard, 'leftDoubleClick', function(position) {
                    callbacks.onDoubleClick(getIndex());
                });
            }
            if(callbacks.onClick) {
                setListener(billboard, 'leftClick', function(position) {
                    callbacks.onClick(getIndex());
                });
            }
            if(callbacks.tooltip) {
                setListener(billboard, 'mouseMove', function(position) {
                    _self._drawHelper._tooltip.showAt(position, callbacks.tooltip());
                });
                setListener(billboard, 'mouseOut', function(position) {
                    _self._drawHelper._tooltip.setVisible(false);
                });
            }
        }

        return billboard;
    }

    _.BillboardGroup.prototype.insertBillboard = function(index, position, callbacks) {
        this._orderedBillboards.splice(index, 0, this.createBillboard(position, callbacks));
    }

    _.BillboardGroup.prototype.addBillboard = function(position, callbacks) {
        this._orderedBillboards.push(this.createBillboard(position, callbacks));
    }

    _.BillboardGroup.prototype.addBillboards = function(positions, callbacks) {
        var index =  0;
        for(; index < positions.length; index++) {
            this.addBillboard(positions[index], callbacks);
        }
    }

    _.BillboardGroup.prototype.updateBillboardsPositions = function(positions) {
        var index =  0;
        for(; index < positions.length; index++) {
            this.getBillboard(index).position = positions[index];
        }
    }

    _.BillboardGroup.prototype.countBillboards = function() {
        return this._orderedBillboards.length;
    }

    _.BillboardGroup.prototype.getBillboard = function(index) {
        return this._orderedBillboards[index];
    }

    _.BillboardGroup.prototype.removeBillboard = function(index) {
        this._billboards.remove(this.getBillboard(index));
        this._orderedBillboards.splice(index, 1);
    }

    _.BillboardGroup.prototype.remove = function() {
        this._billboards = this._billboards && this._billboards.removeAll() && this._billboards.destroy();
    }

    _.BillboardGroup.prototype.setOnTop = function() {
        this._scene.primitives.raiseToTop(this._billboards);
    }

    _.prototype.cleanUp = function() {
        if ( this._prevEntity != undefined) {
            this._cesiumViewer.entities.remove(this._prevEntity);
            this._prevEntity = undefined
        }

        if (this._markers != undefined) {
            this._markers.remove();
            this._markers = undefined;
        }

        if ( this._volumeLabel != undefined) {
            this._cesiumViewer.entities.remove(this._volumeLabel);
            this._volumeLabel = undefined;
        }

        this._tooltip.setVisible(false);
      }

    _.prototype.startDrawing = function(options) {

        var scene = this._scene;

        scene.globe.depthTestAgainstTerrain = true;
        var tooltip = this._tooltip;

        var minPoints =  3;

        var positions = [];
        this._positions = positions;

        var mouseHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);

        this._mouseHandler = mouseHandler;

        var markers = new _.BillboardGroup(this, defaultBillboard);
        this._markers = markers;

        // Now wait for start
        mouseHandler.setInputAction(function(movement) {
            if(movement.position != null) {
                var ray = scene.camera.getPickRay(movement.position);
                var cartesian = scene.globe.pick(ray, scene);

                if (cartesian) {
                    // first click
                    if(positions.length == 0) {
                        positions.push(cartesian.clone());
                        markers.addBillboard(positions[0]);
                    }

                    if(positions.length >=4 ) {
                        var firstPointScreenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
                            this._cesiumViewer.scene, positions[0]);

                        if (firstPointScreenPosition != undefined) {
                            var dx = firstPointScreenPosition.x - movement.position.x;
                            var dy = firstPointScreenPosition.y - movement.position.y;

                            var delta = dx * dx + dy * dy;

                            if (delta < 16) {
                                positions.pop();
                                this.stopDrawing();
                                return;
                            }
                        }
                    }

                    // add new point to point array
                    // this one will move with the mouse
                    positions.push(cartesian);

                    // add marker at the new position
                    markers.addBillboard(cartesian);

                    if(positions.length >= minPoints) {

                        if ( this._prevEntity != undefined)
                            this._cesiumViewer.entities.remove(this._prevEntity);

                        var drawingPolygon = {
                                polygon : {
                                    hierarchy : {
                                        positions : positions
                                    } ,
                                    material : Cesium.Color.RED.withAlpha(0.5),
                                }
                        };

                        this._prevEntity  = this._cesiumViewer.entities.add(drawingPolygon);
                    }
                }
            }
        }.bind(this), Cesium.ScreenSpaceEventType.LEFT_CLICK);

        mouseHandler.setInputAction(function(movement) {
            var position = movement.endPosition;

            if(position != null) {
                if(positions.length == 0) {
                    tooltip.showAt(position, "<p>Click to add first point</p>");
                } else {
                    var ray = scene.camera.getPickRay(position);
                    var cartesian = scene.globe.pick(ray, scene);

                    if (cartesian) {
                        positions.pop();
                        // make sure it is slightly different
                        //cartesian.y += (1 + Math.random());
                        positions.push(cartesian);

                        // update marker
                        markers.getBillboard(positions.length - 1).position = cartesian;
                        // show tooltip
                        tooltip.showAt(position, "<p>Click to add new point (" + positions.length + ")</p>" + (positions.length > minPoints ? "<p>Click first point to finish drawing</p>" : ""));

                        if(positions.length >= 3) {

                            if(positions.length >=4 ) {
                                var firstPointScreenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
                                    this._cesiumViewer.scene, positions[0]);

                                if (firstPointScreenPosition != undefined) {
                                    var dx = firstPointScreenPosition.x - position.x;
                                    var dy = firstPointScreenPosition.y - position.y;

                                    var delta = dx * dx + dy * dy;

                                    if (delta < 16) {
                                        document.body.style.cursor = 'pointer';
                                    }
                                    else
                                        document.body.style.cursor = 'default';
                                }
                            }

                            if ( this._prevEntity != undefined)
                                this._cesiumViewer.entities.remove(this._prevEntity);

                            var drawingPolygon = {
                                polygon : {
                                    hierarchy : {
                                        positions : positions
                                    } ,
                                    material : Cesium.Color.RED.withAlpha(0.5),
                                }
                            };

                            this._prevEntity  = this._cesiumViewer.entities.add(drawingPolygon);
                        }
                   }
                }
            }
        }.bind(this), Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        mouseHandler.setInputAction(function(movement) {
            if(positions.length < minPoints + 2) {
                return;
            } else {
                this.stopDrawing();
            }
        }.bind(this), Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    }

    _.prototype.stopDrawing = function() {
       if(this._mouseHandler != undefined) {
           this._mouseHandler.destroy();
           this._mouseHandler = undefined;
       }

       if (this._markers != undefined) {
           this._markers.remove();
           this._markers = undefined;
       }

       if ( this._prevEntity != undefined)
            this._cesiumViewer.entities.remove(this._prevEntity);

       if ( this._volumeLabel != undefined) {
           this._cesiumViewer.entities.remove(this._volumeLabel);
           this._volumeLabel = undefined;
       }

       this._tooltip.setVisible(false);

       document.body.style.cursor = 'wait';

       var maxHeight =  this.computeCutVolume();

       document.body.style.cursor = 'default';

       var drawingPolygon = {
            polygon : {
                hierarchy : {
                    positions : this._positions
                } ,
                extrudedHeight: maxHeight,
                closeTop : false,
                closeBottom : false,
                material : Cesium.Color.RED.withAlpha(0.5),
                outline : true,
                outlineColor : Cesium.Color.WHITE,
                outlineWidth : 2
            }
        };

        this._prevEntity  = this._cesiumViewer.entities.add(drawingPolygon);
     }

    function computeCentroidOfPolygon(positions) {
        var x = [];
        var y = [];

        for (var i = 0; i < positions.length; i++ ) {
            var cartographic = Cesium.Cartographic.fromCartesian(positions[i]);

            x.push(cartographic.longitude);
            y.push(cartographic.latitude);
        }

        var x0 = 0.0, y0 = 0.0 , x1 = 0.0, y1 = 0.0;
        var signedArea = 0.0;
        var a = 0.0;
        var centroidx = 0.0, centroidy = 0.0;

        for (i = 0; i < positions.length ; i ++) {
            x0 = x[i];
            y0 = y[i];

            if ( i == positions.length -1 ) {
                x1 = x[0];
                y1 = y[0];
            } else {
                x1 = x[i + 1];
                y1 = y[i + 1];
            }

            a = x0 * y1 - x1 * y0;
            signedArea += a;
            centroidx += (x0 + x1) * a;
            centroidy += (y0 + y1) * a;
        }

        signedArea *= 0.5;
        centroidx /= (6.0 * signedArea);
        centroidy /= (6.0 * signedArea);

        return new Cesium.Cartographic(centroidx, centroidy);
      }

    function computeAreaOfTriangle(pos1, pos2, pos3)
    {
        var a = Cesium.Cartesian3.distance(pos1, pos2);
        var b = Cesium.Cartesian3.distance(pos2, pos3);
        var c = Cesium.Cartesian3.distance(pos3, pos1);

        var S = (a + b + c) / 2;

        return Math.sqrt(S * (S - a) * (S - b) * (S - c));
     }

    _.prototype.computeCutVolume = function() {

        var tileAvailability = this._cesiumViewer.terrainProvider.availability;

        var maxLevel = 0;
        var minHeight = 15000;

        for (var i = 0; i < this._positions.length; i++) {
            var cartographic = Cesium.Cartographic.fromCartesian(this._positions[i]);
            var height = this._scene.globe.getHeight(cartographic);

            if(minHeight > height)
                minHeight = height;

            var level = tileAvailability.computeMaximumLevelAtPosition(cartographic);

            if(maxLevel < level)
                maxLevel = level;
       }

       //var granularity =  Math.PI/ Math.pow(2, maxLevel);
       var granularity =  Math.PI/ Math.pow(2, 11);

       granularity = granularity / (64);

       var polygonGeometry = new Cesium.PolygonGeometry.fromPositions(
            {
                positions : this._positions,
                vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
                granularity : granularity
            }
        );

        //polygon subdivision

        var geom = new Cesium.PolygonGeometry.createGeometry(polygonGeometry);

        var totalCutVolume = 0;
        var maxHeight = 0;

        var i0, i1, i2;
        var height1, height2, height3;
        var p1, p2, p3;
        var cartesian;
        var cartographic;
        var bottomArea;

        for (var i = 0; i < geom.indices.length ; i += 3) {
            i0 = geom.indices[i];
            i1 = geom.indices[i + 1];
            i2 = geom.indices[i + 2];

            cartesian = new Cesium.Cartesian3(geom.attributes.position.values[i0 * 3],
                                                  geom.attributes.position.values[i0 *3 + 1],
                                                  geom.attributes.position.values[i0 *3 + 2]);

            cartographic = Cesium.Cartographic.fromCartesian(cartesian);

            height1= this._scene.globe.getHeight(cartographic);

            p1 = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0/*height1 + 1000*/);

            if(maxHeight < height1)
                maxHeight = height1;

            cartesian = new Cesium.Cartesian3(geom.attributes.position.values[i1 * 3],
                                              geom.attributes.position.values[i1 *3 + 1],
                                              geom.attributes.position.values[i1 *3 + 2]);

            cartographic = Cesium.Cartographic.fromCartesian(cartesian);

            height2 = this._scene.globe.getHeight(cartographic);

            var p2 = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0 /*height2 + 1000*/);

            if(maxHeight < height2)
                maxHeight = height2;

            cartesian = new Cesium.Cartesian3(geom.attributes.position.values[i2 * 3],
                                              geom.attributes.position.values[i2 * 3 + 1],
                                              geom.attributes.position.values[i2 *3 + 2]);

            cartographic = Cesium.Cartographic.fromCartesian(cartesian);

            height3 = this._scene.globe.getHeight(cartographic);

            p3 = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0 /*height3 + 1000*/);

            if(maxHeight < height3)
                maxHeight = height3;

            bottomArea = computeAreaOfTriangle(p1, p2, p3);

            totalCutVolume = totalCutVolume + bottomArea * (height1- minHeight + height2 - minHeight + height3 - minHeight) / 3;

           /* var positionsarr = [];

            positionsarr.push(p1);
            positionsarr.push(p2);
            positionsarr.push(p3);

            var drawingPolygon = {
                polygon : {
                    hierarchy : {
                        positions : positionsarr
                    } ,
                    perPositionHeight : true,
                    material : Cesium.Color.RED.withAlpha(0.5),
                    outline : true,
                    outlineColor : Cesium.Color.WHITE,
                    outlineWidth : 2
                }
            };

            this._cesiumViewer.entities.add(drawingPolygon);*/
        }

        var centroid = computeCentroidOfPolygon(this._positions);

        this._volumeLabel = this._cesiumViewer.entities.add({
            position: Cesium.Cartesian3.fromRadians(centroid.longitude, centroid.latitude, maxHeight + 1000),
            label : {
                text : 'Cut Volume ' + totalCutVolume.toString() + 'm3'
            }
        });

        return maxHeight;
   }

     _.Toolbar = (function () {

        //constructor

        function _(cesiumMeasure, options) {

            //container must be specified

            if (!(Cesium.defined(options.container))) {
                throw new Cesium.DeveloperError('Container is required');
            }

            var drawOptions = {
                measureTerrainVolumeIcon: "./img/measure_terrain_volume.png",
                cleaningIcon: "./img/cleaning.png"
            };

            var toolbar = document.createElement('DIV');
            toolbar.className = 'cesiumMeasureToolbar';
            options.container.appendChild(toolbar);

            function addButton(imgUrl, callback) {
                var div = document.createElement('DIV');
                div.className = 'cesiumMeasureToolbarButton';
                toolbar.appendChild(div);
                div.onclick = callback;
                var span = document.createElement('SAPN');
                div.appendChild(span);
                var image = document.createElement('IMG');
                image.src = imgUrl;
                span.appendChild(image);
                return div;
            }

            addButton(drawOptions.measureTerrainVolumeIcon, function () {
                cesiumMeasure.startDrawing({});
            })

            addButton(drawOptions.cleaningIcon, function () {
                cesiumMeasure.cleanUp();
            })
        }

        return _;
    })();

    return _;
})();