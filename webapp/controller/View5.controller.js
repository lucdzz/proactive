sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("project2.controller.View5", {
        onInit: function () {},

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("View4");
        },

        onExportExcel: function () {
            MessageToast.show("Exporting report to Excel...");
        },

        onPrintSmartform: function () {
            MessageBox.information("Smartform print simulated.\nSmartform: ZMRP_REPORT_FORM");
        },

        onSendMail: function () {
            MessageBox.success("Email alert sent successfully to Procurement Department!");
        }
    });
});
