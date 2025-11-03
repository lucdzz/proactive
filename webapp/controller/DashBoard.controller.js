sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel"
], function (Controller, MessageToast, MessageBox, JSONModel) {
    "use strict";

    return Controller.extend("zpg.mrp.ui.controller.DashBoard", {

        // onInit: function () {
        //     const sRole = localStorage.getItem("MRP_ROLE") || "";
        //     if (!sRole) {
        //         this.getOwnerComponent().getRouter().navTo("Login");
        //         return;
        //     }

        //     const oRoleModel = new sap.ui.model.json.JSONModel({ role: sRole });
        //     this.getView().setModel(oRoleModel, "UserRole");

        //     this.byId("tileMonitor").setVisible(false);
        //     this.byId("tileForecast").setVisible(false);
        //     this.byId("tileProposal").setVisible(false);
        //     this.byId("tileApproval").setVisible(false);
        //     this._applyRoleVisibility();
        //     this._loadKPIData();
        //     this._loadChartData();

        //     const oChart = this.byId("vizStockTrend");
        //     oChart.setVizProperties({
        //         title: {
        //             text: "📊 Xu hướng Tồn kho Thực tế vs Dự báo",
        //             visible: true
        //         },
        //         plotArea: {
        //             dataLabel: { visible: true },
        //             window: { start: "firstDataPoint", end: "lastDataPoint" },
        //             line: { width: 2 }
        //         },
        //         valueAxis: {
        //             title: { text: "Số lượng vật tư (Qty)" }
        //         },
        //         categoryAxis: {
        //             title: { text: "Kỳ (Period)" }
        //         },
        //         legend: {
        //             visible: true,
        //             title: { text: "Loại dữ liệu" }
        //         }
        //     });
        // },
        onInit: function () {
            this.getOwnerComponent().getRouter()
                .getRoute("DashBoard")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            const sRole = localStorage.getItem("MRP_ROLE") || "";
            if (!sRole) {
                this.getOwnerComponent().getRouter().navTo("Login");
                return;
            }

            // 🔹 Set model role
            const oRoleModel = new sap.ui.model.json.JSONModel({ role: sRole });
            this.getView().setModel(oRoleModel, "UserRole");

            // 🔹 Ẩn toàn bộ trước
            ["tileMonitor", "tileForecast", "tileProposal", "tileApproval"].forEach(id => {
                const oTile = this.byId(id);
                if (oTile) oTile.setVisible(false);
            });

            // 🔹 Hiển thị theo vai trò
            if (sRole === "L1") {       // QLKHO
                this.byId("tileMonitor").setVisible(true);
                this.byId("tileForecast").setVisible(true);
                this.byId("tileProposal").setVisible(true);
            } else if (sRole === "L2") { // QLMH
                this.byId("tileMonitor").setVisible(true);
                this.byId("tileForecast").setVisible(true);
                this.byId("tileApproval").setVisible(true);
            }

            // 🔹 Load dữ liệu sau khi xác định role
            this._loadKPIData();
            this._loadChartData();
        },

        _applyRoleVisibility: function () {
            const sRole = this.getView().getModel("UserRole").getProperty("/role");

            const oTileMonitor = this.byId("tileMonitor");
            const oTileForecast = this.byId("tileForecast");
            const oTileProposal = this.byId("tileProposal");
            const oTileApproval = this.byId("tileApproval");

            [oTileMonitor, oTileForecast, oTileProposal, oTileApproval].forEach(t => t.setVisible(false));

            if (sRole === "L1") {
                oTileMonitor.setVisible(true);
                oTileForecast.setVisible(true);
                oTileProposal.setVisible(true);
            } else if (sRole === "L2") {
                oTileMonitor.setVisible(true);
                oTileForecast.setVisible(true);
                oTileApproval.setVisible(true);
            }
        },
        // =========================================================
        // LOAD DATA cho biểu đồ từ 2 entity
        // =========================================================
        _loadChartData: function () {
            const oModel = this.getOwnerComponent().getModel();
            const that = this;

            if (!oModel) {
                console.warn(" OData model not found!");
                return;
            }

            sap.ui.core.BusyIndicator.show(0);

            //  Đọc tồn kho thực tế từ MRPDiffSet
            const p1 = new Promise(function (resolve, reject) {
                oModel.read("/MRPDiffSet", {
                    success: function (oData) {
                        const mapActual = {};
                        oData.results.forEach(item => {
                            if (item.Period && item.QtyStock) {
                                const key = item.Period;
                                mapActual[key] = (mapActual[key] || 0) + Number(item.QtyStock);
                            }
                        });
                        resolve(mapActual);
                    },
                    error: reject
                });
            });

            //  Đọc forecast từ ForecastSet
            const p2 = new Promise(function (resolve, reject) {
                oModel.read("/ForecastSet", {
                    success: function (oData) {
                        const mapForecast = {};
                        oData.results.forEach(item => {
                            if (item.Period && item.FcstQty) {
                                const key = item.Period;
                                mapForecast[key] = (mapForecast[key] || 0) + Number(item.FcstQty);
                            }
                        });
                        resolve(mapForecast);
                    },
                    error: reject
                });
            });

            //  Gộp 2 nguồn thành 1 dataset cho chart
            Promise.all([p1, p2]).then(([mapActual, mapForecast]) => {
                const allPeriods = Array.from(new Set([
                    ...Object.keys(mapActual),
                    ...Object.keys(mapForecast)
                ])).sort();

                const aData = allPeriods.map(p => ({
                    Period: p,
                    Actual: mapActual[p] || 0,
                    Forecast: mapForecast[p] || 0
                }));

                const oJSON = new JSONModel({ StockTrend: aData });
                that.getView().setModel(oJSON);

                sap.ui.core.BusyIndicator.hide();
                MessageToast.show(" Loaded chart data (" + aData.length + " periods)");
                console.log(" Chart Data:", aData);
            }).catch(err => {
                sap.ui.core.BusyIndicator.hide();
                console.error(" Failed to load chart data", err);
                MessageToast.show(" Failed to load chart data!");
            });
        },

        _loadKPIData: function () {
            const oModel = this.getOwnerComponent().getModel();
            const that = this;

            if (!oModel) {
                console.warn(" OData model not found!");
                return;
            }

            sap.ui.core.BusyIndicator.show(0);

            // Đọc đồng thời 4 entity
            const p1 = new Promise((resolve, reject) => {
                oModel.read("/MRPDiffSet", {
                    success: (oData) => resolve(oData.results.length),
                    error: reject
                });
            });

            const p2 = new Promise((resolve, reject) => {
                oModel.read("/ForecastSet", {
                    success: (oData) => {
                        // Nếu có trường Accuracy hoặc MAPE
                        if (oData.results.length === 0) return resolve(0);
                        const avg = oData.results.reduce((sum, r) => sum + (Number(r.Accuracy) || 0), 0) / oData.results.length;
                        resolve(avg.toFixed(1)); // ví dụ: 92.5
                    },
                    error: reject
                });
            });

            const p3 = new Promise((resolve, reject) => {
                oModel.read("/ProposalSet", {
                    filters: [new sap.ui.model.Filter("Status", sap.ui.model.FilterOperator.EQ, "N")],
                    success: (oData) => resolve(oData.results.length),
                    error: reject
                });
            });

            const p4 = new Promise((resolve, reject) => {
                oModel.read("/ProposalSet", {
                    filters: [new sap.ui.model.Filter("Status", sap.ui.model.FilterOperator.EQ, "A1")],
                    success: (oData) => resolve(oData.results.length),
                    error: reject
                });
            });

            Promise.all([p1, p2, p3, p4])
                .then(([countDiff, forecastAcc, countProposal, countApproval]) => {
                    sap.ui.core.BusyIndicator.hide();

                    that.byId("numMonitor").setValue(countDiff).setValueColor("Good");
                    that.byId("numForecast").setValue(forecastAcc).setValueColor("Good");
                    that.byId("numProposal").setValue(countProposal).setValueColor(countProposal > 0 ? "Critical" : "Neutral");
                    that.byId("numApproval").setValue(countApproval).setValueColor(countApproval > 0 ? "Error" : "Neutral");

                    console.log(" KPI loaded:", { countDiff, forecastAcc, countProposal, countApproval });
                })
                .catch(err => {
                    sap.ui.core.BusyIndicator.hide();
                    console.error(" KPI load failed:", err);
                    sap.m.MessageToast.show(" Failed to load KPI data!");
                });
        },

        // =========================================================
        // NAVIGATION (các nút trên Dashboard)
        // =========================================================
        onLogout: function () {
            // 🔹 Xác nhận trước khi đăng xuất
            MessageBox.confirm("Bạn có chắc chắn muốn đăng xuất?", {  //  dùng MessageBox (đã import)
                title: "Đăng xuất",
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        // 🔹 Xóa thông tin user trong localStorage
                        localStorage.removeItem("MRP_USERNAME");
                        localStorage.removeItem("MRP_ROLE");
                        localStorage.removeItem("MRP_FULLNAME");

                        MessageToast.show(" Đã đăng xuất khỏi hệ thống!");

                        // 🔹 Chuyển về màn hình Login
                        const oRouter = sap.ui.core.UIComponent.getRouterFor(this);
                        oRouter.navTo("Login", {}, true); // true = clear history
                    }
                }.bind(this)
            });
        },

        onNavMonitor: function () {
            this.getOwnerComponent().getRouter().navTo("Monitor");
        },

        onNavForecast: function () {
            this.getOwnerComponent().getRouter().navTo("Forecast");
        },

        onNavProposal: function () {
            this.getOwnerComponent().getRouter().navTo("Proposal");
        },

        onNavApproval: function () {
            this.getOwnerComponent().getRouter().navTo("Approval");
        },

        onRefreshKPI: function () {
            MessageToast.show(" Refreshing KPI & chart...");
            this._loadKPIData();
            this._loadChartData();
        }
    });
});
