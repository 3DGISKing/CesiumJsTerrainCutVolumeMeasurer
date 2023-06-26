const {BillboardCollection, Cartesian2, Cartesian3, Color, HorizontalOrigin, VerticalOrigin} = window.Cesium;

export default class BillboardGroup {
    constructor(scene, options) {
        this._scene = scene;

        this._options = options;

        // create one common billboard collection for all billboards
        const b = new BillboardCollection();
        this._scene.primitives.add(b);
        this._billboards = b;
        // keep an ordered list of billboards
        this._orderedBillboards = [];
    }

    createBillboard(position) {
        const billboard = this._billboards.add({
            show: true,
            position: position,
            pixelOffset: new Cartesian2(this._options.shiftX, this._options.shiftY),
            eyeOffset: new Cartesian3(0.0, 0.0, -1000.0),
            horizontalOrigin: HorizontalOrigin.CENTER,
            verticalOrigin: VerticalOrigin.CENTER,
            scale: 1.0,
            image: this._options.iconUrl,
            color: new Color(1.0, 1.0, 1.0, 1.0)
        });

        return billboard;
    }

    addBillboard(position) {
        const billboard = this.createBillboard(position);
        this._orderedBillboards.push(billboard);

        return billboard;
    }

    getBillboard(index) {
        return this._orderedBillboards[index];
    }

    destroy() {
        this._billboards.removeAll();
        this._billboards.destroy();
    };
}