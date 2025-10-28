sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/ui/export/Spreadsheet",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/json/JSONModel"
], function (Controller, MessageToast, Spreadsheet, Filter, FilterOperator, JSONModel) {
    "use strict";

    return Controller.extend("zpg.mrp.ui.controller.Monitor", {

        formatter: {
            netState: function (qtyNet) {
                return qtyNet < 0 ? "Error" : "Success";
            },
            riskState: function (riskFlag) {
                return riskFlag === "H" ? "Error" : "Success";
            },
            riskText: function (riskFlag) {
                return riskFlag === "H" ? "Thiếu hụt" : "Ổn định";
            },
            approvalText: function (sStatus) {
                switch (sStatus) {
                    case "N": return "🕓 Chưa gửi đề xuất";
                    case "A1": return "⏳ Đang chờ phê duyệt cấp 2";
                    case "A2": return "✅ Duyệt thành công";
                    case "R1": return "❌ Từ chối cấp 1";
                    case "R2": return "❌ Từ chối cấp 2";
                    default: return sStatus || "";
                }
            },

            approvalState: function (sStatus) {
                switch (sStatus) {
                    case "A1": return "Warning";
                    case "A2": return "Success";
                    case "R1":
                    case "R2": return "Error";
                    default: return "None";
                }
            }

        },

        // =========================================================
        // INIT
        // =========================================================
        onInit: function () {
            var oModel = this.getOwnerComponent().getModel();

            if (!oModel) {
                console.warn("⚠️ OData model chưa sẵn sàng.");
                return;
            }

            // Đợi metadata load xong mới đọc dữ liệu
            oModel.metadataLoaded().then(function () {
                console.log("✅ OData metadata loaded, auto loading MRP...");
                this._loadPlantCache(oModel);
                this._autoLoadMRP(oModel); // ⚡ truyền model vào
            }.bind(this)).catch(function (err) {
                console.error("❌ Metadata load error:", err);
            });
            this.byId("detailArea").setVisible(false);
        },

        onAfterRendering: function () {
            const oDetail = this.byId("detailArea");
            const oLayout = this.byId("layoutMaster");
            if (oDetail) {
                oDetail.setVisible(false);
                oLayout.setSize("100%");
            }
        },

        _loadPlantCache: function (oModel) {
            return new Promise((resolve, reject) => {
                oModel.read("/PlantSet", {
                    success: (oData) => {
                        this._oPlantCache = new JSONModel(oData.results);
                        console.log("✅ Cached PlantSet:", oData.results.length);
                        resolve(true); // ✅ Quan trọng
                    },
                    error: (oError) => {
                        console.error("❌ Failed to preload PlantSet", oError);
                        reject(oError);
                    }
                });
            });
        },

        _loadMaterialCache: function (oModel) {
            return new Promise((resolve, reject) => {
                oModel.read("/MaterialSet", {
                    success: (oData) => {
                        this._oMaterialCache = new JSONModel(oData.results);
                        console.log("✅ Cached MaterialSet:", oData.results.length);
                        resolve(true); // ✅ Quan trọng
                    },
                    error: (oError) => {
                        console.error("❌ Failed to preload MaterialSet", oError);
                        reject(oError);
                    }
                });
            });
        },

        _autoLoadMRP: function (oModel) {
            console.log("🚀 Auto load triggered");
            oModel = oModel || this.getOwnerComponent().getModel();
            if (!oModel) return;

            const oTable = this.getView().byId("tblMRPMaster");
            sap.ui.core.BusyIndicator.show(0);

            // Đợi cache Plant & Material cùng sẵn sàng
            Promise.all([
                this._loadPlantCache(oModel),
                this._loadMaterialCache(oModel)
            ]).then(() => {
                oModel.read("/MRPDiffSet", {
                    success: function (oData) {
                        sap.ui.core.BusyIndicator.hide();

                        if (!oData.results?.length) {
                            sap.m.MessageToast.show("⚠️ No MRP data found.");
                            oTable.setModel(new JSONModel([]));
                            this.byId("detailArea").setVisible(false);
                            this.byId("layoutMaster").setSize("100%");
                            return;
                        }

                        // ✅ enrich dữ liệu
                        this._oMRPData = this._enrichWithNames(oData.results);

                        // ✅ bind lại vào bảng (client-side)
                        const oTable = this.byId("tblMRPMaster");
                        const oJSON = new JSONModel(this._oMRPData);
                        oTable.setModel(oJSON);

                        const oTemplate = this.byId("itemMRPMaster").clone(); // clone template từ XML
                        oTable.unbindItems();
                        oTable.bindItems("/", oTemplate);

                        // Ẩn vùng detail
                        this.byId("detailArea").setVisible(false);
                        this.byId("layoutMaster").setSize("100%");

                        sap.m.MessageToast.show(`✅ Loaded ${this._oMRPData.length} records`);
                    }.bind(this),
                    error: function (oErr) {
                        sap.ui.core.BusyIndicator.hide();
                        console.error("❌ Load MRP failed", oErr);
                        sap.m.MessageToast.show("❌ Failed to load MRP data!");
                    }
                });
            });
        },

        _loadInitialMRP: function () {
            var oModel = this.getView().getModel();
            if (!oModel) {
                console.warn("⚠️ OData model chưa sẵn sàng, bỏ qua auto load.");
                return;
            }

            var oTable = this.getView().byId("tblMRP");
            sap.m.MessageToast.show("Loading initial MRP data...");

            oModel.read("/MRPDiffSet", {
                success: function (oData) {
                    this._oMRPData = oData.results || [];
                    this._pageSize = 20;
                    this._currentPage = 1;
                    this._totalPages = Math.max(1, Math.ceil(this._oMRPData.length / this._pageSize));

                    this._updatePage(); // ⚡ hiển thị trang đầu tiên

                    console.log("✅ Auto-loaded MRP records:", this._oMRPData.length);
                    sap.m.MessageToast.show("✅ Loaded " + this._oMRPData.length + " records");
                }.bind(this),
                error: function (oError) {
                    sap.m.MessageToast.show("❌ Failed to auto load MRP data!");
                    console.error(oError);
                }
            });
        },

        // =========================================================
        // RUN MONITOR
        // =========================================================
        onRunMonitor: function () {
            var oModel = this.getView().getModel();
            var oTable = this.getView().byId("tblMRP");
            MessageToast.show("Running MRP Monitor...");

            oModel.read("/MRPDiffSet", {
                success: function (oData) {
                    //  Lưu toàn bộ dataset
                    this._oMRPData = oData.results || [];

                    //  Thiết lập phân trang
                    this._pageSize = 20;
                    this._currentPage = 1;
                    this._totalPages = Math.max(1, Math.ceil(this._oMRPData.length / this._pageSize));

                    //  Hiển thị trang đầu tiên
                    this._updatePage();

                    MessageToast.show("✅ Loaded " + this._oMRPData.length + " records");
                }.bind(this),
                error: function (oError) {
                    MessageToast.show("❌ Failed to load data!");
                    console.error(oError);
                }
            });
        },

        // =========================================================
        // SAVE RESULT
        // =========================================================
        onSaveResult: function () {
            var oModel = this.getView().getModel();
            var aData = this._oMRPData; // Dữ liệu đang hiển thị
            if (!aData || aData.length === 0) {
                sap.m.MessageToast.show("⚠️ No data to save!");
                return;
            }

            sap.ui.core.BusyIndicator.show(0);

            // 🧩 Tạo batch create entries
            oModel.setUseBatch(true);
            oModel.setDeferredGroups(["saveGroup"]);

            aData.forEach(function (item) {
                oModel.createEntry("/MRPDiffSet", {
                    groupId: "saveGroup",
                    properties: {
                        Matnr: item.Matnr,
                        Werks: item.Werks,
                        Lgort: item.Lgort,
                        Period: item.Period,
                        QtyStock: item.QtyStock,
                        QtyRcpt: item.QtyRcpt,
                        QtyReq: item.QtyReq,
                        SafetyQty: item.SafetyQty,
                        QtyNet: item.QtyNet,
                        RiskFlag: item.RiskFlag,
                        Aeusr: sap.ushell.Container.getUser().getId() || "FIORI_USER"
                    }
                });
            });

            oModel.submitChanges({
                groupId: "saveGroup",
                success: function () {
                    sap.ui.core.BusyIndicator.hide();
                    sap.m.MessageToast.show("✅ Data saved successfully to ZTB_MRP_DIFF");
                },
                error: function (oError) {
                    sap.ui.core.BusyIndicator.hide();
                    console.error(oError);
                    sap.m.MessageToast.show("❌ Save failed! Check backend logs (ST22/SICF).");
                }
            });
        },

        // =========================================================
        // EXPORT EXCEL
        // =========================================================
        onExportExcel: function () {
            var oTable = this.getView().byId("tblMRP");
            var aData = oTable.getModel()?.getData();

            if (!aData || aData.length === 0) {
                MessageToast.show("⚠️ No data to export!");
                return;
            }

            var aCols = [
                { label: "Material", property: "Matnr" },
                { label: "Plant", property: "Werks" },
                { label: "Storage Loc", property: "Lgort" },
                { label: "Period", property: "Period" },
                { label: "Stock Qty", property: "QtyStock" },
                { label: "Receipt Qty", property: "QtyRcpt" },
                { label: "Req. Qty", property: "QtyReq" },
                { label: "Safety Qty", property: "SafetyQty" },
                { label: "Net Qty", property: "QtyNet" },
                { label: "Risk", property: "RiskFlag" },
                { label: "Changed By", property: "Aeusr" }
            ];

            var oSettings = {
                workbook: { columns: aCols },
                dataSource: aData,
                fileName: "MRP_Monitor_Export.xlsx"
            };

            var oSheet = new Spreadsheet(oSettings);
            oSheet.build().then(function () {
                MessageToast.show("✅ Export successful!");
            }).finally(function () {
                oSheet.destroy();
            });
        },

        // =========================================================
        // FILTER (client-side, fixed)
        // =========================================================
        onFilter: function () {
            var oTable = this.getView().byId("tblMRP");
            var aData = this._oMRPData || [];

            // ✅ Lấy Plant chính xác (ưu tiên selectedKey)
            // var oInpPlant = this.getView().byId("inpPlant");
            // var sPlant = oInpPlant.data("selectedKey");
            // if (!sPlant) {
            //     sPlant = oInpPlant.getValue().trim();
            // }
            var oInpPlant = this.getView().byId("inpPlant");
            var sPlantValue = oInpPlant.getValue().trim();
            var sPlantKey = oInpPlant.data("selectedKey");

            // Nếu người dùng gõ vào thì lấy luôn text nhập (HD00), không dùng cache key cũ
            var sPlant = sPlantValue || sPlantKey;


            var oInpMatnr = this.getView().byId("inpMatnr");
            var sMatnrValue = oInpMatnr.getValue().trim();
            var sMatnrKey = oInpMatnr.data("selectedKey");
            var sMatnr = sMatnrValue || sMatnrKey;

            var bShortage = this.getView().byId("chkShortage").getSelected();
            var dFrom = this.getView().byId("dpFrom").getDateValue();
            var dTo = this.getView().byId("dpTo").getDateValue();

            function formatPeriod(oDate) {
                if (!oDate) return null;
                var y = oDate.getFullYear();
                var m = (oDate.getMonth() + 1).toString().padStart(2, '0');
                return y + m;
            }

            var sFrom = formatPeriod(dFrom);
            var sTo = formatPeriod(dTo);

            console.log("🔍 Filter params:", {
                Plant: sPlant, Material: sMatnr, Shortage: bShortage, From: sFrom, To: sTo
            });

            // ✅ Filter logic
            var aFiltered = aData.filter(function (item) {
                var matchPlant = !sPlant || item.Werks === sPlant;
                var matchMatnr = !sMatnr || item.Matnr === sMatnr;
                var matchRisk = !bShortage || item.RiskFlag === "H";
                var matchPeriod = (!sFrom && !sTo) ||
                    (item.Period >= sFrom && item.Period <= sTo);
                return matchPlant && matchMatnr && matchRisk && matchPeriod;
            });

            var oJSON = new JSONModel(aFiltered);
            oTable.setModel(oJSON);
            oTable.bindItems({
                path: "/",
                template: oTable.getBindingInfo("items").template.clone()
            });
            this._oMRPData = aFiltered;
            this._currentPage = 1;
            this._totalPages = Math.ceil(this._oMRPData.length / this._pageSize);
            this._updatePage();

            MessageToast.show("✅ Filter applied (" + aFiltered.length + " rows)");
            console.log("Filtered results:", aFiltered.slice(0, 5));
        },

        // =========================================================
        // VALUE HELP PLANT (debounce + fixed selectedKey)
        // =========================================================
        onValueHelpPlant: function () {
            var oView = this.getView();
            var that = this;

            // Nếu dialog chưa tồn tại -> khởi tạo
            if (!this._oPlantDialog) {
                this._oPlantDialog = new sap.m.SelectDialog({
                    title: "Select Plant",
                    search: function (oEvent) {
                        // Dùng search event thay vì liveChange => đáng tin cậy hơn
                        var sValue = oEvent.getParameter("value")?.trim() || "";
                        var oBinding = oEvent.getSource().getBinding("items");

                        if (!sValue) {
                            oBinding.filter([]); // xoá filter nếu trống
                            return;
                        }

                        var aFilters = [
                            new Filter("Werks", FilterOperator.Contains, sValue),
                            new Filter("Name1", FilterOperator.Contains, sValue)
                        ];

                        oBinding.filter(new Filter(aFilters, false));
                    },

                    confirm: function (oEvt) {
                        var oSelectedItem = oEvt.getParameter("selectedItem");
                        if (oSelectedItem) {
                            var sKey = oSelectedItem.getDescription(); // mã HD00
                            var sText = oSelectedItem.getTitle();      // tên plant
                            oView.byId("inpPlant").setValue(sKey);     // ⚡ chỉ hiển thị mã
                            oView.byId("inpPlant").data("selectedKey", sKey);
                            console.log("✅ Selected Plant:", sKey);
                        }
                    },

                    items: {
                        path: "/",
                        template: new sap.m.StandardListItem({
                            title: "{Name1}",
                            description: "{Werks}"
                        })
                    }
                });

                // Nếu có cache thì dùng cache (đã load ở _loadPlantCache)
                if (this._oPlantCache) {
                    this._oPlantDialog.setModel(this._oPlantCache);
                } else {
                    // Nếu chưa có cache -> fallback dùng model gốc OData
                    this._oPlantDialog.setModel(this.getView().getModel());
                }
            }

            // Mở dialog
            this._oPlantDialog.open();
        },
        // =========================================================
        // VALUE HELP MATERIAL (tìm kiếm theo mã & tên)
        // =========================================================
        onValueHelpMaterial: function () {
            var oView = this.getView();
            var that = this;

            // Nếu dialog chưa được tạo thì khởi tạo mới
            if (!this._oMaterialDialog) {
                this._oMaterialDialog = new sap.m.SelectDialog({
                    title: "Select Material",
                    liveChange: function (oEvent) {
                        var sValue = oEvent.getParameter("value")?.trim() || "";
                        var oBinding = oEvent.getSource().getBinding("items");

                        if (!sValue) {
                            oBinding.filter([]); // xoá filter nếu trống
                            return;
                        }

                        var aFilters = [
                            new sap.ui.model.Filter("Matnr", sap.ui.model.FilterOperator.Contains, sValue),
                            new sap.ui.model.Filter("Maktx", sap.ui.model.FilterOperator.Contains, sValue)
                        ];

                        oBinding.filter(new sap.ui.model.Filter(aFilters, false));
                    },

                    confirm: function (oEvent) {
                        var oSelectedItem = oEvent.getParameter("selectedItem");
                        if (oSelectedItem) {
                            var sKey = oSelectedItem.getDescription(); // mã vật tư
                            var sText = oSelectedItem.getTitle();      // tên vật tư
                            oView.byId("inpMatnr").setValue(sKey + " - " + sText);
                            oView.byId("inpMatnr").data("selectedKey", sKey);
                            console.log("✅ Selected Material:", sKey);
                        }
                    },

                    items: {
                        path: "/",
                        template: new sap.m.StandardListItem({
                            title: "{Maktx}",     // mô tả vật tư
                            description: "{Matnr}" // mã vật tư
                        })
                    }
                });

                // Dùng cache nếu đã load trước
                if (this._oMaterialCache) {
                    this._oMaterialDialog.setModel(this._oMaterialCache);
                } else {
                    // Lần đầu -> load từ OData service
                    var oModel = this.getView().getModel();
                    oModel.read("/MaterialSet", {
                        success: function (oData) {
                            that._oMaterialCache = new sap.ui.model.json.JSONModel(oData.results);
                            that._oMaterialDialog.setModel(that._oMaterialCache);
                            console.log("✅ Cached MaterialSet:", oData.results.length);
                            that._oMaterialDialog.open();
                        },
                        error: function (oError) {
                            sap.m.MessageToast.show("❌ Failed to load materials!");
                            console.error(oError);
                        }
                    });
                    return; // Dừng ở đây để tránh mở dialog 2 lần
                }
            }

            // Mở dialog (nếu cache đã sẵn)
            this._oMaterialDialog.open();
        },
        // =========================================================
        // NAVIGATION – Reset All (Home)
        // =========================================================
        onNavHome: function () {
            const oRouter = this.getOwnerComponent().getRouter();
            if (!oRouter) {
                sap.m.MessageToast.show("⚠️ Router not found!");
                return;
            }

            // 🔄 Reset các input filter
            const oView = this.getView();
            oView.byId("inpPlant").setValue("");
            oView.byId("inpMatnr").setValue("");
            oView.byId("dpFrom").setValue("");
            oView.byId("dpTo").setValue("");
            oView.byId("chkShortage").setSelected(false);

            sap.m.MessageToast.show("🔙 Back to Dashboard (UC-00)");
            oRouter.navTo("DashBoard"); // về Dashboard
        },
        // =========================================================
        // PAGINATION
        // =========================================================
        _updatePage: function () {
            var oTable = this.getView().byId("tblMRP");
            if (!this._oMRPData || this._oMRPData.length === 0) {
                oTable.setModel(new JSONModel([]));
                this.getView().byId("txtPageInfo").setText("No data");
                return;
            }

            // 🔹 Bổ sung enrich trước khi phân trang
            this._oMRPData = this._enrichWithNames(this._oMRPData);

            var iStart = (this._currentPage - 1) * this._pageSize;
            var iEnd = iStart + this._pageSize;
            var aPageData = this._oMRPData.slice(iStart, iEnd);

            var oJSON = new sap.ui.model.json.JSONModel(aPageData);
            oTable.setModel(oJSON);

            var oTemplate = oTable.getItems()[0].clone();
            oTable.unbindItems();
            oTable.bindItems("/", oTemplate);

            this.getView().byId("txtPageInfo").setText(
                "Page " + this._currentPage + " / " + this._totalPages
            );
        },

        _enrichWithNames: function (aData) {
            const aPlants = this._oPlantCache?.getData() || [];
            const aMats = this._oMaterialCache?.getData() || [];

            // 🧠 Dùng trim() và replace(/^0+/, '') để xử lý padding
            function normalize(s) {
                if (!s) return "";
                return String(s).trim().replace(/^0+/, "");
            }

            return aData.map(item => {
                const sMatnr = normalize(item.Matnr);
                const sWerks = normalize(item.Werks);

                const oMat = aMats.find(m => normalize(m.Matnr) === sMatnr);
                const oPlant = aPlants.find(p => normalize(p.Werks) === sWerks);

                return {
                    ...item,
                    PlantName: oPlant ? oPlant.Name1 : "",
                    MaterialName: oMat ? oMat.Maktx : ""
                };
            });
        },


        onSelectMRP: function (oEvent) {
            const oContext = oEvent.getParameter("listItem")?.getBindingContext();
            const oDetail = this.byId("detailArea");
            const oLayout = this.byId("layoutMaster");

            if (!oContext) {
                oDetail.setVisible(false);
                oLayout.setSize("100%");
                return;
            }

            // Nếu đang ẩn → bật lại
            if (!oDetail.getVisible()) {
                oDetail.setVisible(true);
                oLayout.setSize("60%");
            }

            oDetail.setModel(this.byId("tblMRPMaster").getModel());
            oDetail.setBindingContext(oContext);
        },
        onCloseDetail: function () {
            const oDetail = this.byId("detailArea");
            const oLayout = this.byId("layoutMaster");

            oDetail.setVisible(false);
            oLayout.setSize("100%");

            // Bỏ chọn hàng trong bảng
            const oTable = this.byId("tblMRPMaster");
            if (oTable) oTable.removeSelections();
        },

        onNextPage: function () {
            if (this._currentPage < this._totalPages) {
                this._currentPage++;
                this._updatePage();
            } else {
                sap.m.MessageToast.show("Already at last page");
            }
        },

        onPrevPage: function () {
            if (this._currentPage > 1) {
                this._currentPage--;
                this._updatePage();
            } else {
                sap.m.MessageToast.show("Already at first page");
            }
        },

    });
});
