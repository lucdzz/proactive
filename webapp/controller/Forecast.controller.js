sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/format/DateFormat"
], function (Controller, MessageToast, MessageBox, JSONModel, Filter, FilterOperator, DateFormat) {
    "use strict";

    return Controller.extend("zpg.mrp.ui.controller.Forecast", {

        // =========================================================
        // INIT – auto load forecast when page opens
        // =========================================================
        onInit: function () {
            this.oModel = this.getOwnerComponent().getModel();
            this.oTable = this.byId("fcst_tblForecast");

            const oDetail = this.byId("fcst_detailPage");
            if (oDetail) oDetail.setVisible(false);
            const that = this;
            this.oModel.metadataLoaded().then(function () {
                that._loadPlantAndMaterialCache();
                that._autoLoadForecast();
            });
        },

        // =========================================================
        // AUTO LOAD (for UC-02)
        // =========================================================
        _autoLoadForecast: function (bForceReload) {
            const that = this;
            const sMethod = this.byId("fcst_selMethod").getSelectedKey();
            const sPeriod = this.byId("fcst_selPeriod").getSelectedKey();

            const oDetail = this.byId("fcst_detailPage");
            const oLayout = this.byId("fcst_layoutMaster");
            if (oDetail) {
                oDetail.setVisible(false);
                oLayout.setSize("100%");
            }
            sap.ui.core.BusyIndicator.show(0);

            // Luôn reload full từ backend
            this.oModel.read("/ForecastSet", {
                success: function (oData) {
                    sap.ui.core.BusyIndicator.hide();

                    if (!oData.results || oData.results.length === 0) {
                        MessageToast.show("No forecast data found!");
                        that._aForecastData = [];
                        that._updatePage();
                        return;
                    }

                    const oDateFormat = sap.ui.core.format.DateFormat.getDateInstance({ pattern: "yyyy-MM-dd" });
                    oData.results.forEach(item => {
                        if (item.Aedat) item.Aedat = oDateFormat.format(new Date(item.Aedat));
                    });

                    that._aFullForecastData = that._enrichWithNames(oData.results);
                    that._filterAndDisplay(sMethod);

                },
                error: function (oError) {
                    sap.ui.core.BusyIndicator.hide();
                    console.error("Forecast OData error", oError);
                    sap.m.MessageBox.error("Failed to load forecast data.");
                }
            });
        },
        _filterAndDisplay: function (sMethod) {
            let aFiltered = this._aFullForecastData || [];
            if (sMethod) {
                aFiltered = aFiltered.filter(item => item.Method?.toUpperCase() === sMethod.toUpperCase());
            }

            this._aForecastData = aFiltered;
            this._pageSize = 10;
            this._currentPage = 1;
            this._totalPages = Math.max(1, Math.ceil(aFiltered.length / this._pageSize));

            this._updatePage();
            MessageToast.show(`Filtered ${aFiltered.length} records (Method: ${sMethod})`);
        },

        // =========================================================
        // NAVIGATION
        // =========================================================
        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("DashBoard");
        },

        onNavProposal: function () {
            this.getOwnerComponent().getRouter().navTo("Proposal");
        },

        // =========================================================
        // RUN FORECAST – manual refresh button
        // =========================================================
        onRunForecast: function () {
            this._autoLoadForecast();
        },

        // =========================================================
        // FILTER BY METHOD OR PERIOD (when dropdown changes)
        // =========================================================
        onMethodChange: function () {
            const sMethod = this.byId("fcst_selMethod").getSelectedKey();
            const sPeriod = this.byId("fcst_selPeriod").getSelectedKey();

            MessageToast.show(`🔄 Reloading forecast (${sMethod}, ${sPeriod})...`);
            //Gọi lại full OData mỗi lần đổi dropdown
            this._autoLoadForecast(true); // truyền cờ "true" để báo là reload full
        },

        // =========================================================
        // SAVE FORECAST (placeholder)
        // =========================================================
        onSaveForecast: function () {
            MessageToast.show("Forecast saved to ZTB_MRP_FCST (stub).");
        },

        // =========================================================
        // SIMULATE (dummy)
        // =========================================================
        onSimulate: function () {
            MessageToast.show("🔍 Simulation mode");

            const aDummy = [
                { Matnr: "SPAR0009", Werks: "GADN", Period: "202509", Method: "MA", Window: "03", FcstQty: 2, Aedat: "2025-09-28", Aeusr: "LEARN-522" },
                { Matnr: "SPAR0009", Werks: "GADN", Period: "202510", Method: "WA", Window: "03", FcstQty: 2, Aedat: "2025-10-01", Aeusr: "LEARN-522" }
            ];

            this._aForecastData = aDummy;
            this._pageSize = 10;
            this._currentPage = 1;
            this._totalPages = 1;
            this._updatePage();
        },

        // =========================================================
        // PAGINATION
        // =========================================================
        _updatePage: function () {
            const oTable = this.byId("fcst_tblForecast");
            if (!this._aForecastData || this._aForecastData.length === 0) {
                oTable.unbindItems();
                oTable.setModel(new JSONModel([]));
                this._renderPagination(); // clear pagination
                return;
            }

            const iStart = (this._currentPage - 1) * this._pageSize;
            const iEnd = iStart + this._pageSize;
            const aPageData = this._aForecastData.slice(iStart, iEnd);

            const oTemplate = new sap.m.ColumnListItem({
                cells: [
                    new sap.m.Text({ text: "{Matnr}" }),
                    new sap.m.Text({ text: "{MaterialName}" }),
                    new sap.m.Text({ text: "{Werks}" }),
                    new sap.m.Text({ text: "{PlantName}" }),
                    new sap.m.Text({ text: "{Period}" }),
                    new sap.m.Text({ text: "{Method}" })
                ]
            });

            const oJSON = new JSONModel(aPageData);
            oTable.setModel(oJSON);
            oTable.unbindItems();
            oTable.bindItems("/", oTemplate);

            this._renderPagination(); //render lại thanh số trang
        },
        _renderPagination: function () {
            const oHBox = this.byId("fcst_pageNumbers");
            if (!oHBox) return;
            oHBox.removeAllItems();

            const totalPages = this._totalPages || 1;
            const current = this._currentPage;

            // Ẩn/hiện nút Previous / Next
            this.byId("fcst_btnPrev").setVisible(current > 1);
            this.byId("fcst_btnNext").setVisible(current < totalPages);

            const createButton = (num, active = false) => {
                return new sap.m.Button({
                    text: num.toString(),
                    type: active ? "Emphasized" : "Transparent",
                    press: () => {
                        this._currentPage = num;
                        this._updatePage();
                    }
                }).addStyleClass("sapUiTinyMarginBegin sapUiTinyMarginEnd");
            };

            // Hiển thị 5 nút xung quanh current
            let start = Math.max(1, current - 2);
            let end = Math.min(totalPages, start + 4);
            if (end - start < 4) start = Math.max(1, end - 4);

            if (start > 1) {
                oHBox.addItem(createButton(1));
                if (start > 2) oHBox.addItem(new sap.m.Text({ text: "..." }));
            }

            for (let i = start; i <= end; i++) {
                oHBox.addItem(createButton(i, i === current));
            }

            if (end < totalPages) {
                if (end < totalPages - 1) oHBox.addItem(new sap.m.Text({ text: "..." }));
                oHBox.addItem(createButton(totalPages));
            }
        },

        _loadPlantAndMaterialCache: function () {
            const oModel = this.oModel;
            const that = this;

            oModel.read("/PlantSet", {
                success: function (oData) {
                    that._oPlantCache = new JSONModel(oData.results);
                    console.log("Cached PlantSet:", oData.results.length);
                },
                error: function (err) {
                    console.error("Failed to load PlantSet", err);
                }
            });

            oModel.read("/MaterialSet", {
                success: function (oData) {
                    that._oMaterialCache = new JSONModel(oData.results);
                    console.log("Cached MaterialSet:", oData.results.length);
                },
                error: function (err) {
                    console.error("Failed to load MaterialSet", err);
                }
            });
        },

        _enrichWithNames: function (aData) {
            const aPlants = this._oPlantCache?.getData() || [];
            const aMats = this._oMaterialCache?.getData() || [];

            return aData.map(item => {
                const oPlant = aPlants.find(p => p.Werks === item.Werks);
                const oMat = aMats.find(m => m.Matnr === item.Matnr);
                return {
                    ...item,
                    PlantName: oPlant ? oPlant.Name1 : "",
                    MaterialName: oMat ? oMat.Maktx : ""
                };
            });
        },

        onSelectForecast: function (oEvent) {
            const oListItem = oEvent.getParameter("listItem");
            if (!oListItem) return; //Không có selection thực tế

            const oContext = oListItem.getBindingContext();
            if (!oContext) return;

            const oDetail = this.byId("fcst_detailPage");
            const oLayout = this.byId("fcst_layoutMaster");

            // Hiển thị detail chỉ khi có user action
            if (!oDetail.getVisible()) {
                oDetail.setVisible(true);
                oLayout.setSize("60%");
            }

            oDetail.setModel(this.byId("fcst_tblForecast").getModel());
            oDetail.setBindingContext(oContext);
        },

        onCloseDetail: function () {
            const oDetail = this.byId("fcst_detailPage");
            const oLayout = this.byId("fcst_layoutMaster");
            const oTable = this.byId("fcst_tblForecast");

            oDetail.setVisible(false);
            oLayout.setSize("100%");
            if (oTable) oTable.removeSelections();
        },

        onNextPage: function () {
            if (this._currentPage < this._totalPages) {
                this._currentPage++;
                this._updatePage();
            } else {
                MessageToast.show("Already at last page");
            }
        },

        onPrevPage: function () {
            if (this._currentPage > 1) {
                this._currentPage--;
                this._updatePage();
            } else {
                MessageToast.show("Already at first page");
            }
        }

    });
});
