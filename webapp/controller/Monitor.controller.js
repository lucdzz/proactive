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
                    case "N": return "Chưa gửi đề xuất";
                    case "A1": return "Đang chờ phê duyệt";
                    case "A2": return "Duyệt thành công";
                    case "R2": return "Từ chối";
                    default: return sStatus || "";
                }
            },
            approvalState: function (sStatus) {
                switch (sStatus) {
                    case "A1": return "Warning";
                    case "A2": return "Success";
                    case "R2": return "Error";
                    default: return "None";
                }
            },
            formatPeriod: function (sPeriod) {
                if (!sPeriod || sPeriod.length !== 6) return sPeriod;
                const year = sPeriod.substring(0, 4);
                const month = sPeriod.substring(4, 6);
                return "Tháng " + month + "/" + year;
            }
        },

        onInit: function () {
            var oModel = this.getOwnerComponent().getModel();
            if (!oModel) {
                console.warn("OData model chưa sẵn sàng.");
                return;
            }

            this.byId("detailArea").setVisible(false);
            this._oRowTemplate = this.byId("itemMRPMaster").clone();

            // ✅ Khởi tạo biến phân trang
            this._pageSize = 20;
            this._currentPage = 1;
            this._totalRecords = 0;
            this._currentFilters = []; // Lưu filters hiện tại

            const that = this;
            oModel.metadataLoaded().then(function () {
                console.log("OData metadata loaded");
                that._loadPlantCache(oModel);
                that._loadMaterialCache(oModel);
                that._loadCurrentPage(); //Load trang đầu tiên
            }).catch(function (err) {
                console.error("Metadata load error:", err);
            });
        },

        onAfterRendering: function () {
            const oDetail = this.byId("detailArea");
            const oLayout = this.byId("layoutMaster");
            if (oDetail) {
                oDetail.setVisible(false);
                oLayout.setSize("100%");
            }
        },

        // =========================================================
        // LOAD CACHE (unchanged)
        // =========================================================
        _loadPlantCache: function (oModel) {
            const that = this;
            oModel.read("/PlantSet", {
                success: (oData) => {
                    that._oPlantCache = new JSONModel(oData.results);
                    console.log("Cached PlantSet:", oData.results.length);
                },
                error: (oError) => {
                    console.error("Failed to preload PlantSet", oError);
                }
            });
        },

        _loadMaterialCache: function (oModel) {
            const that = this;
            oModel.read("/MaterialSet", {
                success: (oData) => {
                    that._oMaterialCache = new JSONModel(oData.results);
                    console.log("Cached MaterialSet:", oData.results.length);
                },
                error: (oError) => {
                    console.error("Failed to preload MaterialSet", oError);
                }
            });
        },

        // =========================================================
        // SERVER-SIDE PAGINATION
        // =========================================================
        _loadCurrentPage: function () {
            const that = this;
            const oModel = this.getOwnerComponent().getModel();

            if (!oModel) {
                console.error("Model not available");
                return;
            }

            sap.ui.core.BusyIndicator.show(0);

            //Tính toán skip/top cho OData
            const iSkip = (this._currentPage - 1) * this._pageSize;
            const iTop = this._pageSize;

            //Load ProposalSet để merge status
            Promise.all([
                new Promise((resolve) => {
                    oModel.read("/ProposalSet", {
                        success: (oData) => resolve(oData.results || []),
                        error: (oErr) => {
                            console.error("Failed to load ProposalSet", oErr);
                            resolve([]);
                        }
                    });
                }),
                new Promise((resolve, reject) => {
                    // Load MRPDiffSet với pagination
                    oModel.read("/MRPDiffSet", {
                        urlParameters: {
                            "$skip": iSkip,
                            "$top": iTop,
                            "$inlinecount": "allpages" // Lấy tổng số records
                        },
                        filters: that._currentFilters,
                        success: (oData) => resolve(oData),
                        error: (oErr) => reject(oErr)
                    });
                })
            ]).then(([aProposals, oMRPData]) => {
                sap.ui.core.BusyIndicator.hide();

                const aMRP = oMRPData.results || [];

                // Lấy tổng số records từ __count
                if (oMRPData.__count !== undefined) {
                    that._totalRecords = parseInt(oMRPData.__count, 10);
                    that._totalPages = Math.max(1, Math.ceil(that._totalRecords / that._pageSize));
                } else {
                    that._totalRecords = aMRP.length;
                    that._totalPages = 1;
                }

                if (!aMRP.length) {
                    MessageToast.show("No data found");
                    that._updateTableWithData([]);
                    return;
                }

                // Merge với Proposal status
                const normalize = (val) => {
                    if (!val) return "";
                    return String(val).trim().replace(/^0+/, "");
                };

                const aMerged = aMRP.map(mrp => {
                    const match = aProposals.find(p =>
                        normalize(p.Matnr) === normalize(mrp.Matnr) &&
                        normalize(p.Werks) === normalize(mrp.Werks) &&
                        normalize(p.Period) === normalize(mrp.Period)
                    );
                    return {
                        ...mrp,
                        Status: match ? match.Status : "N",
                        Remark: match ? match.Remark : ""
                    };
                });

                // Enrich với Plant/Material names
                const aEnriched = that._enrichWithNames(aMerged);
                that._updateTableWithData(aEnriched);

                MessageToast.show(`✅ Page ${that._currentPage}/${that._totalPages} (${that._totalRecords} total)`);

            }).catch((err) => {
                sap.ui.core.BusyIndicator.hide();
                console.error("Load page failed:", err);
                MessageToast.show("Failed to load data!");
            });
        },

        _updateTableWithData: function (aData) {
            const oTable = this.byId("tblMRPMaster");
            const oJSON = new JSONModel(aData);
            oTable.setModel(oJSON);

            const oTemplate = this._oRowTemplate.clone();
            oTable.unbindItems();
            oTable.bindItems("/", oTemplate);

            // this.byId("txtPageInfo").setText(
            //     `Page ${this._currentPage} / ${this._totalPages} (${this._totalRecords} total)`
            // );

            // Ẩn detail khi load page mới
            this.byId("detailArea").setVisible(false);
            this.byId("layoutMaster").setSize("100%");
            this._renderPagination(); //render phân trang động

        },

        _renderPagination: function () {
            const oHBox = this.byId("pageNumbers");
            if (!oHBox) return;
            oHBox.removeAllItems();

            const totalPages = this._totalPages || 1;
            const current = this._currentPage;

            // Ẩn/hiện Previous & Next
            this.byId("btnPrev").setVisible(current > 1);
            this.byId("btnNext").setVisible(current < totalPages);

            const createButton = (num, isActive = false) => {
                return new sap.m.Button({
                    text: num.toString(),
                    type: isActive ? "Emphasized" : "Transparent",
                    press: () => {
                        this._currentPage = num;
                        this._loadCurrentPage();
                    }
                }).addStyleClass("sapUiTinyMarginBegin sapUiTinyMarginEnd");
            };

            // Giới hạn hiển thị 5 nút trang quanh current
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

        _enrichWithNames: function (aData) {
            const aPlants = this._oPlantCache?.getData() || [];
            const aMats = this._oMaterialCache?.getData() || [];

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

        // =========================================================
        // PAGINATION CONTROLS
        // =========================================================
        onNextPage: function () {
            if (this._currentPage < this._totalPages) {
                this._currentPage++;
                this._loadCurrentPage();
            } else {
                MessageToast.show("Already at last page");
            }
        },

        onPrevPage: function () {
            if (this._currentPage > 1) {
                this._currentPage--;
                this._loadCurrentPage();
            } else {
                MessageToast.show("Already at first page");
            }
        },

        // =========================================================
        // FILTER (with server-side reload)
        // =========================================================
        onFilter: function () {
            var sPlant = this.byId("inpPlant").getValue().trim() || this.byId("inpPlant").data("selectedKey");
            var sMatnr = this.byId("inpMatnr").getValue().trim() || this.byId("inpMatnr").data("selectedKey");
            var bShortage = this.byId("chkShortage").getSelected();
            var sStatusKey = this.byId("selStatusFilter").getSelectedKey();

            var dFrom = this.byId("dpFrom").getDateValue();
            var dTo = this.byId("dpTo").getDateValue();

            function formatPeriod(oDate) {
                if (!oDate) return null;
                var y = oDate.getFullYear();
                var m = (oDate.getMonth() + 1).toString().padStart(2, '0');
                return y + m;
            }

            var sFrom = formatPeriod(dFrom);
            var sTo = formatPeriod(dTo);

            console.log("Filter params:", {
                Plant: sPlant, Material: sMatnr, Shortage: bShortage, Status: sStatusKey, From: sFrom, To: sTo
            });

            //Build OData filters
            var aFilters = [];

            if (sPlant) {
                aFilters.push(new Filter("Werks", FilterOperator.EQ, sPlant));
            }
            if (sMatnr) {
                aFilters.push(new Filter("Matnr", FilterOperator.EQ, sMatnr));
            }
            if (bShortage) {
                aFilters.push(new Filter("RiskFlag", FilterOperator.EQ, "H"));
            }
            if (sFrom) {
                aFilters.push(new Filter("Period", FilterOperator.GE, sFrom));
            }
            if (sTo) {
                aFilters.push(new Filter("Period", FilterOperator.LE, sTo));
            }

            //  Status filter không thể làm ở backend (vì Status từ ProposalSet)
            // Sẽ filter ở client-side sau khi merge

            this._currentFilters = aFilters;
            this._currentStatusFilter = sStatusKey; // Lưu để filter client-side
            this._currentPage = 1; // Reset về trang đầu
            this._loadCurrentPage();
        },

        onStatusChange: function () {
            this.onFilter();
        },

        // =========================================================
        // RUN MONITOR (reload first page)
        // =========================================================
        onRunMonitor: function () {
            MessageToast.show("Running MRP Monitor...");
            this._currentPage = 1;
            this._currentFilters = [];
            this._loadCurrentPage();
        },

        // =========================================================
        // VALUE HELP (unchanged)
        // =========================================================
        onValueHelpPlant: function () {
            var oView = this.getView();
            var that = this;

            if (!this._oPlantDialog) {
                this._oPlantDialog = new sap.m.SelectDialog({
                    title: "Select Plant",
                    search: function (oEvent) {
                        var sValue = oEvent.getParameter("value")?.trim() || "";
                        var oBinding = oEvent.getSource().getBinding("items");

                        if (!sValue) {
                            oBinding.filter([]);
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
                            var sKey = oSelectedItem.getDescription();
                            oView.byId("inpPlant").setValue(sKey);
                            oView.byId("inpPlant").data("selectedKey", sKey);
                            console.log("Selected Plant:", sKey);
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

                if (this._oPlantCache) {
                    this._oPlantDialog.setModel(this._oPlantCache);
                } else {
                    this._oPlantDialog.setModel(this.getView().getModel());
                }
            }

            this._oPlantDialog.open();
        },

        onValueHelpMaterial: function () {
            var oView = this.getView();
            var that = this;

            if (!this._oMaterialDialog) {
                this._oMaterialDialog = new sap.m.SelectDialog({
                    title: "Select Material",
                    liveChange: function (oEvent) {
                        var sValue = oEvent.getParameter("value")?.trim() || "";
                        var oBinding = oEvent.getSource().getBinding("items");

                        if (!sValue) {
                            oBinding.filter([]);
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
                            var sKey = oSelectedItem.getDescription();
                            var sText = oSelectedItem.getTitle();
                            oView.byId("inpMatnr").setValue(sKey + " - " + sText);
                            oView.byId("inpMatnr").data("selectedKey", sKey);
                            console.log("Selected Material:", sKey);
                        }
                    },

                    items: {
                        path: "/",
                        template: new sap.m.StandardListItem({
                            title: "{Maktx}",
                            description: "{Matnr}"
                        })
                    }
                });

                if (this._oMaterialCache) {
                    this._oMaterialDialog.setModel(this._oMaterialCache);
                } else {
                    var oModel = this.getView().getModel();
                    oModel.read("/MaterialSet", {
                        success: function (oData) {
                            that._oMaterialCache = new sap.ui.model.json.JSONModel(oData.results);
                            that._oMaterialDialog.setModel(that._oMaterialCache);
                            console.log("Cached MaterialSet:", oData.results.length);
                            that._oMaterialDialog.open();
                        },
                        error: function (oError) {
                            sap.m.MessageToast.show("Failed to load materials!");
                            console.error(oError);
                        }
                    });
                    return;
                }
            }

            this._oMaterialDialog.open();
        },

        // =========================================================
        // DETAIL PANEL
        // =========================================================
        onSelectMRP: function (oEvent) {
            const oContext = oEvent.getParameter("listItem")?.getBindingContext();
            const oDetail = this.byId("detailArea");
            const oLayout = this.byId("layoutMaster");

            // Không có dòng được chọn → ẩn panel
            if (!oContext) {
                oDetail.setVisible(false);
                oLayout.setSize("100%");
                return;
            }

            // Mở vùng detail (nếu đang ẩn)
            if (!oDetail.getVisible()) {
                oDetail.setVisible(true);
                oLayout.setSize("60%");
            }

            // Gắn binding context của dòng master
            const oTableModel = this.byId("tblMRPMaster").getModel();
            oDetail.setModel(oTableModel);
            oDetail.setBindingContext(oContext);

            // Chuẩn bị gọi OData cho TransSet
            const oModel = this.getOwnerComponent().getModel(); // ODataModel
            const oSelected = oContext.getObject();
            const oTableTrans = this.byId("tblTransDetail");

            if (!oSelected) {
                console.warn("No selected row data");
                return;
            }

            // Build đúng entity key cho MRPDiff
            const sMatnr = encodeURIComponent(oSelected.Matnr);
            const sWerks = encodeURIComponent(oSelected.Werks);
            const sLgort = encodeURIComponent(oSelected.Lgort);
            const sPeriod = encodeURIComponent(oSelected.Period);

            const sPath = `/MRPDiffSet(Matnr='${sMatnr}',Werks='${sWerks}',Lgort='${sLgort}',Period='${sPeriod}')/TransSet`;
            console.log("Loading TransSet from:", sPath);

            sap.ui.core.BusyIndicator.show(0);

            oModel.read(sPath, {
                success: function (oData) {
                    sap.ui.core.BusyIndicator.hide();

                    let aTrans = oData.results || [];

                    // Sắp xếp giảm dần theo ngày chứng từ
                    aTrans.sort((a, b) => {
                        const dateA = new Date(a.DocDate);
                        const dateB = new Date(b.DocDate);
                        return dateB - dateA; // newest first
                    });

                    // Bind data vào bảng giao dịch
                    aTrans = oData.results.filter(t =>
                        t.Matnr === oSelected.Matnr &&
                        t.Werks === oSelected.Werks &&
                        t.Lgort === oSelected.Lgort &&
                        t.Period === oSelected.Period
                    );
                    aTrans.sort((a, b) => new Date(b.DocDate) - new Date(a.DocDate));
                    const oJSON = new sap.ui.model.json.JSONModel(aTrans);
                    oTableTrans.setModel(oJSON);


                    // clone template nếu chưa có
                    const oTemplate = oTableTrans.getBindingInfo("items")?.template;
                    if (oTemplate) {
                        oTableTrans.unbindItems();
                        oTableTrans.bindItems("/", oTemplate.clone());
                    }

                    console.log(`Loaded ${aTrans.length} transactions for ${sMatnr}/${sWerks}/${sPeriod}`);
                    sap.m.MessageToast.show(`Đã tải ${aTrans.length} giao dịch.`);
                },
                error: function (oErr) {
                    sap.ui.core.BusyIndicator.hide();
                    console.error("Failed to load TransSet", oErr);
                    sap.m.MessageToast.show("Không thể tải danh sách chứng từ (TransSet).");
                }
            });
        },

        onCloseDetail: function () {
            const oDetail = this.byId("detailArea");
            const oLayout = this.byId("layoutMaster");

            oDetail.setVisible(false);
            oLayout.setSize("100%");

            const oTable = this.byId("tblMRPMaster");
            if (oTable) oTable.removeSelections();
        },

        // =========================================================
        // NAVIGATION
        // =========================================================
        onNavHome: function () {
            const oRouter = this.getOwnerComponent().getRouter();
            if (!oRouter) {
                sap.m.MessageToast.show("Router not found!");
                return;
            }

            const oView = this.getView();
            oView.byId("inpPlant").setValue("");
            oView.byId("inpMatnr").setValue("");
            oView.byId("dpFrom").setValue("");
            oView.byId("dpTo").setValue("");
            oView.byId("chkShortage").setSelected(false);

            sap.m.MessageToast.show("Back to Dashboard (UC-00)");
            oRouter.navTo("DashBoard");
        },

        // =========================================================
        // EXPORT EXCEL (Note: Will export ALL data, not just current page)
        // =========================================================
        onExportExcel: function () {
            MessageToast.show("Export will load all data. This may take time...");

            const that = this;
            const oModel = this.getOwnerComponent().getModel();

            sap.ui.core.BusyIndicator.show(0);

            // Load tất cả data để export
            oModel.read("/MRPDiffSet", {
                filters: this._currentFilters,
                success: function (oData) {
                    sap.ui.core.BusyIndicator.hide();

                    const aData = oData.results || [];
                    if (!aData.length) {
                        MessageToast.show(" No data to export!");
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
                        { label: "Risk", property: "RiskFlag" }
                    ];

                    var oSettings = {
                        workbook: { columns: aCols },
                        dataSource: aData,
                        fileName: "MRP_Monitor_Export.xlsx"
                    };

                    var oSheet = new Spreadsheet(oSettings);
                    oSheet.build().then(function () {
                        MessageToast.show(" Export successful!");
                    }).finally(function () {
                        oSheet.destroy();
                    });
                },
                error: function (oError) {
                    sap.ui.core.BusyIndicator.hide();
                    MessageToast.show(" Export failed!");
                    console.error(oError);
                }
            });
        },

        // =========================================================
        // SAVE RESULT (removed - not applicable for pagination)
        // =========================================================
        onSaveResult: function () {
            MessageToast.show(" Save function requires loading all data");
        }
    });
});