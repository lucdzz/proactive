sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "zpg/mrp/ui/model/models" 
], function (UIComponent, Device, models) {
    "use strict";

    return UIComponent.extend("zpg.mrp.ui.Component", {

        metadata: {
            manifest: "json"
        },

        init: function () {
            // Gọi init mặc định của UI5
            UIComponent.prototype.init.apply(this, arguments);

            // Kích hoạt routing
            this.getRouter().initialize();

            // Gán model OData để các View có thể dùng ngay
            var oModel = this.getModel("mainService");
            if (!oModel) {
                oModel = new sap.ui.model.odata.v2.ODataModel("/sap/opu/odata/sap/ZGW_MRP_MONITOR_SRV/");
                this.setModel(oModel);
                console.log("✅ Default ODataModel manually attached.");
            } else {
                console.log("✅ ODataModel loaded from manifest.");
            }

            // Model thiết bị
            this.setModel(models.createDeviceModel(), "device");
        }
    });
});
