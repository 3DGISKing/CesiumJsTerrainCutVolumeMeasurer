const {defined, DeveloperError} = window.Cesium;

import CutVolumeMeasurer from "./CutVolumeMeasurer.js"

export default class Toolbar {
    constructor(cutVolumeMeasurer, options) {
        //container must be specified

        if (!(cutVolumeMeasurer instanceof CutVolumeMeasurer)) {
            throw new DeveloperError('CutVolumeMeasurer is required');
        }

        if (!(defined(options.container))) {
            throw new DeveloperError('Container is required');
        }

        this._container = document.createElement('div');

        this._container.className = 'cesiumMeasureToolbar';
        options.container.appendChild(this._container);

        const drawOptions = {
            measureTerrainVolumeIcon: "./img/measure_terrain_volume.png",
            cleaningIcon: "./img/cleaning.png"
        };

        this.addButton(drawOptions.measureTerrainVolumeIcon, function () {
            cutVolumeMeasurer.cleanUp();
            cutVolumeMeasurer.startDrawing({});
        });

        this.addButton(drawOptions.cleaningIcon, function () {
            cutVolumeMeasurer.cleanUp();
        })
    }

    addButton(imgUrl, callback) {
        const div = document.createElement('div');

        div.className = 'cesiumMeasureToolbarButton';
        this._container.appendChild(div);
        div.onclick = callback;

        const span = document.createElement('span');
        div.appendChild(span);

        const image = document.createElement('img');
        image.src = imgUrl;

        span.appendChild(image);

        return div;
    }
}