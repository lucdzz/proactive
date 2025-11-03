sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (Controller, MessageToast, MessageBox, JSONModel, Filter, FilterOperator) {
    "use strict";

    return Controller.extend("zpg.mrp.ui.controller.Proposal", {

        formatter: {
            statusText: function (sStatus) {
                switch (sStatus) {
                    case "N": return "Chưa gửi đề xuất";
                    case "A1": return "Đang chờ phê duyệt";
                    case "A2": return "Duyệt thành công";
                    case "R2": return "Từ chối";
                    default: return sStatus || "";
                }
            },

            statusState: function (sStatus) {
                if (!sStatus) return "None";
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
            this.oModel = this.getOwnerComponent().getModel();
            this.oTable = this.byId("prop_tblProposal");

            this.byId("prop_detailArea").setVisible(false);
            this._oRowTemplate = this.byId("prop_rowTemplate").clone();

            //Khởi tạo phân trang server-side
            this._pageSize = 20;
            this._currentPage = 1;
            this._totalRecords = 0;
            this._currentFilters = [];

            const that = this;
            this.oModel.metadataLoaded().then(function () {
                that._loadPlantAndMaterialCache();
                that._loadCurrentPage(); //Load trang đầu
            });

            this.getOwnerComponent().getRouter().getRoute("Proposal").attachPatternMatched(
                function () { that._loadCurrentPage(); },
                this
            );
        },

        onAfterRendering: function () {
            const oDetail = this.byId("prop_detailArea");
            const oLayout = this.byId("prop_layoutMaster");
            if (oDetail && oLayout) {
                oDetail.setVisible(false);
                oLayout.setSize("100%");
            }
        },

        // =========================================================
        // SERVER-SIDE PAGINATION
        // =========================================================
        _loadCurrentPage: function () {
            const that = this;
            sap.ui.core.BusyIndicator.show(0);

            const iSkip = (this._currentPage - 1) * this._pageSize;
            const iTop = this._pageSize;

            //Filter shortage (QtyNet < 0)
            const aBaseFilters = [new Filter("QtyNet", FilterOperator.LT, 0)];
            const aCombinedFilters = aBaseFilters.concat(this._currentFilters);

            Promise.all([
                new Promise((resolve) => {
                    that.oModel.read("/ProposalSet", {
                        success: (oData) => resolve(oData.results || []),
                        error: (oErr) => {
                            console.error("Failed to load ProposalSet", oErr);
                            resolve([]);
                        }
                    });
                }),
                new Promise((resolve, reject) => {
                    that.oModel.read("/MRPDiffSet", {
                        urlParameters: {
                            "$skip": iSkip,
                            "$top": iTop,
                            "$inlinecount": "allpages"
                        },
                        filters: aCombinedFilters,
                        success: (oData) => resolve(oData),
                        error: (oErr) => reject(oErr)
                    });
                })
            ]).then(([aProposals, oMRPData]) => {
                sap.ui.core.BusyIndicator.hide();

                const aDiff = oMRPData.results || [];

                if (oMRPData.__count !== undefined) {
                    that._totalRecords = parseInt(oMRPData.__count, 10);
                    that._totalPages = Math.max(1, Math.ceil(that._totalRecords / that._pageSize));
                } else {
                    that._totalRecords = aDiff.length;
                    that._totalPages = 1;
                }

                if (!aDiff.length) {
                    MessageBox.warning("No shortage data found.");
                    that._updateTableWithData([]);
                    return;
                }

                const normalize = (val) => {
                    if (!val) return "";
                    return String(val).trim().replace(/^0+/, "");
                };

                const aMerged = aDiff.map(r => {
                    const rMat = normalize(r.Matnr);
                    const rWer = normalize(r.Werks);
                    const rPer = normalize(r.Period);

                    const match = aProposals.find(p =>
                        normalize(p.Matnr) === rMat &&
                        normalize(p.Werks) === rWer &&
                        normalize(p.Period) === rPer
                    );

                    return {
                        Matnr: r.Matnr,
                        MaterialName: that._getMaterialName(r.Matnr),
                        Werks: r.Werks,
                        PlantName: that._getPlantName(r.Werks),
                        Qty: Math.abs(r.QtyNet),
                        Meins: r.Meins || "PCE",
                        Period: r.Period,
                        Status: match ? match.Status : "N",
                        Remark: match ? match.Remark : "",
                        QtyStock: r.QtyStock,
                        QtyRcpt: r.QtyRcpt,
                        QtyReq: r.QtyReq,
                        SafetyQty: r.SafetyQty,
                        QtyNet: r.QtyNet
                    };
                });

                // Client-side status filter (nếu có)
                let aFiltered = aMerged;
                if (that._currentStatusFilter && that._currentStatusFilter !== "ALL") {
                    aFiltered = aMerged.filter(item => item.Status === that._currentStatusFilter);
                }

                that._updateTableWithData(aFiltered);

                MessageToast.show(`Page ${that._currentPage}/${that._totalPages} (${that._totalRecords} total)`);

            }).catch((err) => {
                sap.ui.core.BusyIndicator.hide();
                console.error("Load page failed:", err);
                MessageBox.error("Failed to load proposal data.");
            });
        },

        _updateTableWithData: function (aData) {
            const oTable = this.byId("prop_tblProposal");
            const oJSON = new JSONModel(aData);
            oTable.setModel(oJSON);

            const oTemplate = this._oRowTemplate.clone();
            oTable.unbindItems();
            oTable.bindItems("/", oTemplate);

            // this.byId("prop_txtPageInfo").setText(
            //     `Page ${this._currentPage} / ${this._totalPages} (${this._totalRecords} total)`
            // );

            this.byId("prop_detailArea").setVisible(false);
            this.byId("prop_layoutMaster").setSize("100%");
            this._renderPagination(); //render dãy số trang
        },

        _renderPagination: function () {
            const oHBox = this.byId("prop_pageNumbers");
            if (!oHBox) return;
            oHBox.removeAllItems();

            const totalPages = this._totalPages || 1;
            const current = this._currentPage;

            // Ẩn/hiện Previous & Next
            this.byId("prop_btnPrev").setVisible(current > 1);
            this.byId("prop_btnNext").setVisible(current < totalPages);

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

        _getPlantName: function (sWerks) {
            const aPlants = this._oPlantCache?.getData() || [];
            const normalize = (s) => String(s || "").trim().replace(/^0+/, "");
            const o = aPlants.find(p => normalize(p.Werks) === normalize(sWerks));
            return o ? o.Name1 : "";
        },

        _getMaterialName: function (sMatnr) {
            const aMats = this._oMaterialCache?.getData() || [];
            const normalize = (s) => String(s || "").trim().replace(/^0+/, "");
            const o = aMats.find(m => normalize(m.Matnr) === normalize(sMatnr));
            return o ? o.Maktx : "";
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
        // FILTER
        // =========================================================
        onFilter: function () {
            var sPlant = this.byId("prop_inpPlant").getValue().trim() || this.byId("prop_inpPlant").data("selectedKey");
            var sMatnr = this.byId("prop_inpMatnr").getValue().trim() || this.byId("prop_inpMatnr").data("selectedKey");
            var sStatusKey = this.byId("prop_selStatusFilter").getSelectedKey();

            var dFrom = this.byId("prop_dpFrom").getDateValue();
            var dTo = this.byId("prop_dpTo").getDateValue();

            function formatPeriod(oDate) {
                if (!oDate) return null;
                var y = oDate.getFullYear();
                var m = (oDate.getMonth() + 1).toString().padStart(2, '0');
                return y + m;
            }

            var sFrom = formatPeriod(dFrom);
            var sTo = formatPeriod(dTo);

            console.log("🔍 Filter params:", {
                Plant: sPlant, Material: sMatnr, Status: sStatusKey, From: sFrom, To: sTo
            });

            var aFilters = [];

            if (sPlant) {
                aFilters.push(new Filter("Werks", FilterOperator.EQ, sPlant));
            }
            if (sMatnr) {
                aFilters.push(new Filter("Matnr", FilterOperator.EQ, sMatnr));
            }
            if (sFrom) {
                aFilters.push(new Filter("Period", FilterOperator.GE, sFrom));
            }
            if (sTo) {
                aFilters.push(new Filter("Period", FilterOperator.LE, sTo));
            }

            this._currentFilters = aFilters;
            this._currentStatusFilter = sStatusKey;
            this._currentPage = 1;
            this._loadCurrentPage();
        },

        onStatusChange: function () {
            this.onFilter();
        },

        // =========================================================
        // GENERATE (reload first page)
        // =========================================================
        onGenerate: function () {
            MessageToast.show("Regenerating proposals...");
            this._currentPage = 1;
            this._currentFilters = [];
            this._currentStatusFilter = "ALL";
            this._loadCurrentPage();
        },

        // =========================================================
        // VALUE HELP
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
                            oView.byId("prop_inpPlant").setValue(sKey);
                            oView.byId("prop_inpPlant").data("selectedKey", sKey);
                            console.log(" Selected Plant:", sKey);
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
                            oView.byId("prop_inpMatnr").setValue(sKey + " - " + sText);
                            oView.byId("prop_inpMatnr").data("selectedKey", sKey);
                            console.log(" Selected Material:", sKey);
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
                            console.log(" Cached MaterialSet:", oData.results.length);
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
        // NAVIGATION
        // =========================================================
        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("DashBoard");
            MessageToast.show("Back to Dashboard");
        },

        onNavApproval: function () {
            this.getOwnerComponent().getRouter().navTo("Approval");
        },

        // =========================================================
        // DETAIL PANEL
        // =========================================================
        onSelectProposal: function (oEvent) {
            const oContext = oEvent.getParameter("listItem")?.getBindingContext();
            const oDetail = this.byId("prop_detailArea");
            const oLayout = this.byId("prop_layoutMaster");

            if (!oContext) {
                oDetail.setVisible(false);
                oLayout.setSize("100%");
                return;
            }

            if (!oDetail.getVisible()) {
                oDetail.setVisible(true);
                oLayout.setSize("60%");
            }

            oDetail.setModel(this.byId("prop_tblProposal").getModel());
            oDetail.setBindingContext(oContext);

            const oData = oContext.getObject();
            console.log(" Selected proposal:", oData.Matnr, oData.Werks, oData.Period);
        },

        onCloseDetail: function () {
            const oDetail = this.byId("prop_detailArea");
            const oLayout = this.byId("prop_layoutMaster");

            oDetail.setVisible(false);
            oLayout.setSize("100%");

            const oTable = this.byId("prop_tblProposal");
            if (oTable) {
                oTable.removeSelections();
            }

            console.log(" Detail panel closed");
        },

        // =========================================================
        // SAVE SELECTED PROPOSALS TO SAP
        // =========================================================
        onSaveProposal: async function () {
            const aSelected = this.oTable.getSelectedItems();
            if (aSelected.length === 0) {
                MessageToast.show("Please select at least one proposal to save.");
                return;
            }

            const that = this;
            const oModel = this.oModel;
            let iCreated = 0, iUpdated = 0, iFailed = 0;

            MessageBox.confirm(` Save ${aSelected.length} selected proposal(s) to SAP?`, {
                onClose: async function (sAction) {
                    if (sAction !== MessageBox.Action.OK) return;

                    sap.ui.core.BusyIndicator.show(0);

                    for (const oItem of aSelected) {
                        const oData = oItem.getBindingContext().getObject();
                        const sKey = `/ProposalSet(Matnr='${oData.Matnr}',Werks='${oData.Werks}',Period='${oData.Period}')`;

                        const oCleanData = {
                            Matnr: oData.Matnr,
                            Werks: oData.Werks,
                            Period: oData.Period,
                            Qty: String(oData.Qty),
                            Meins: oData.Meins,
                            Status: "A1",
                            Remark: oData.Remark || "Submitted by Warehouse (Level 1)"
                        };

                        await new Promise((resolve) => {
                            oModel.read(sKey, {
                                success: function () {
                                    oModel.update(sKey, oCleanData, {
                                        success: () => { iUpdated++; resolve(); },
                                        error: (err) => { iFailed++; console.error(err); resolve(); }
                                    });
                                },
                                error: function () {
                                    oModel.create("/ProposalSet", oCleanData, {
                                        success: () => { iCreated++; resolve(); },
                                        error: (err) => { iFailed++; console.error(err); resolve(); }
                                    });
                                }
                            });
                        });
                    }

                    sap.ui.core.BusyIndicator.hide();

                    let sMsg = ` Saved: ${iCreated} created, ${iUpdated} updated`;
                    if (iFailed > 0) {
                        sMsg += `, ${iFailed} failed `;
                        MessageBox.warning(sMsg);
                    } else {
                        MessageBox.success(sMsg);
                    }

                    that._loadCurrentPage();
                }
            });
        },

        // =========================================================
        // SEARCH ( Note: Basic search, not optimized for large datasets)
        // =========================================================
        onSearch: function (oEvent) {
            const sQuery = oEvent.getParameter("newValue")?.trim().toUpperCase() || "";

            if (!sQuery) {
                this._loadCurrentPage();
                return;
            }

            // Simple search - loads current page only
            MessageToast.show(" Searching in current page data...");
        },

        // =========================================================
        // CACHE
        // =========================================================
        _loadPlantAndMaterialCache: function () {
            const oModel = this.oModel;
            const that = this;

            oModel.read("/PlantSet", {
                success: function (oData) {
                    that._oPlantCache = new JSONModel(oData.results || []);
                    console.log(" Cached PlantSet:", oData.results.length);
                },
                error: function (err) {
                    console.error(" Failed to load PlantSet", err);
                    that._oPlantCache = new JSONModel([]);
                }
            });

            oModel.read("/MaterialSet", {
                success: function (oData) {
                    that._oMaterialCache = new JSONModel(oData.results || []);
                    console.log(" Cached MaterialSet:", oData.results.length);
                },
                error: function (err) {
                    console.error(" Failed to load MaterialSet", err);
                    that._oMaterialCache = new JSONModel([]);
                }
            });
        }
    });
});