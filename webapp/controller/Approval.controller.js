sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (Controller, MessageToast, MessageBox, JSONModel, Filter, FilterOperator) {
    "use strict";

    return Controller.extend("zpg.mrp.ui.controller.Approval", {

        formatter: {
            statusText: function (sStatus) {
                switch (sStatus) {
                    case "A1": return "Đang chờ phê duyệt";
                    case "A2": return "Duyệt thành công";
                    case "R2": return "Từ chối";
                    default: return sStatus || "";
                }
            },

            statusState: function (sStatus) {
                if (!sStatus) return "None";
                if (sStatus.length === 1) sStatus = sStatus + "1";

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
            this.oTable = this.byId("appr_tblProposal");

            this.byId("appr_detailArea").setVisible(false);
            this._oRowTemplate = this.byId("appr_rowTemplate").clone();

            // Khởi tạo phân trang server-side
            this._pageSize = 20;
            this._currentPage = 1;
            this._totalRecords = 0;
            this._currentFilters = [];

            const that = this;
            this.oModel.metadataLoaded().then(() => {
                that._loadPlantAndMaterialCache();
                that._loadCurrentPage(); // Load trang đầu
            });
        },

        onAfterRendering: function () {
            const oDetail = this.byId("appr_detailArea");
            const oLayout = this.byId("appr_layoutMaster");
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

            // Build filters dựa trên status filter
            let aStatusFilters = [];
            if (this._currentStatusFilter === "PENDING") {
                aStatusFilters = [new Filter("Status", FilterOperator.EQ, "A1")];
            } else if (this._currentStatusFilter === "APPROVED") {
                aStatusFilters = [new Filter("Status", FilterOperator.EQ, "A2")];
            }
            // ALL thì không filter status

            const aCombinedFilters = aStatusFilters.concat(this._currentFilters);

            this.oModel.read("/ProposalSet", {
                urlParameters: {
                    "$skip": iSkip,
                    "$top": iTop,
                    "$inlinecount": "allpages"
                },
                filters: aCombinedFilters,
                success: function (oData) {
                    sap.ui.core.BusyIndicator.hide();

                    const aProposals = oData.results || [];

                    if (oData.__count !== undefined) {
                        that._totalRecords = parseInt(oData.__count, 10);
                        that._totalPages = Math.max(1, Math.ceil(that._totalRecords / that._pageSize));
                    } else {
                        that._totalRecords = aProposals.length;
                        that._totalPages = 1;
                    }

                    if (!aProposals.length) {
                        MessageToast.show("No proposals found");
                        that._updateTableWithData([]);
                        return;
                    }

                    const aEnriched = that._enrichWithNames(aProposals);
                    that._updateTableWithData(aEnriched);

                    MessageToast.show(` Page ${that._currentPage}/${that._totalPages} (${that._totalRecords} total)`);
                },
                error: function (oError) {
                    sap.ui.core.BusyIndicator.hide();
                    MessageBox.error(" Failed to load proposals.");
                    console.error(oError);
                }
            });
        },

        _updateTableWithData: function (aData) {
            const oTable = this.byId("appr_tblProposal");
            const oJSON = new JSONModel(aData);
            oTable.setModel(oJSON);

            const oTemplate = this._oRowTemplate.clone();
            oTable.unbindItems();
            oTable.bindItems("/", oTemplate);


            this._renderPagination();
            console.log(`Displaying page ${this._currentPage}/${this._totalPages}, showing ${aData.length} items`);
        },

        // =========================================================
        // PAGINATION CONTROLS
        // =========================================================
        _renderPagination: function () {
            const oHBox = this.byId("appr_pageNumbers");
            if (!oHBox) return;
            oHBox.removeAllItems();

            const totalPages = this._totalPages || 1;
            const current = this._currentPage;

            // Ẩn/hiện Previous / Next
            this.byId("appr_btnPrev").setVisible(current > 1);
            this.byId("appr_btnNext").setVisible(current < totalPages);

            const createButton = (num, active = false) => {
                const btn = new sap.m.Button({
                    text: num.toString(),
                    type: active ? "Emphasized" : "Transparent",
                    press: () => {
                        if (this._currentPage !== num) {
                            this._currentPage = num;
                            this._loadCurrentPage();
                        }
                    }
                });
                btn.addStyleClass("sapUiTinyMarginBegin sapUiTinyMarginEnd");
                return btn;
            };

            // Giới hạn hiển thị 5 nút
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
            var sPlant = this.byId("appr_inpPlant").getValue().trim() || this.byId("appr_inpPlant").data("selectedKey");
            var sMatnr = this.byId("appr_inpMatnr").getValue().trim() || this.byId("appr_inpMatnr").data("selectedKey");
            var sStatusKey = this.byId("appr_selStatusFilter").getSelectedKey();

            var dFrom = this.byId("appr_dpFrom").getDateValue();
            var dTo = this.byId("appr_dpTo").getDateValue();

            function formatPeriod(oDate) {
                if (!oDate) return null;
                var y = oDate.getFullYear();
                var m = (oDate.getMonth() + 1).toString().padStart(2, '0');
                return y + m;
            }

            var sFrom = formatPeriod(dFrom);
            var sTo = formatPeriod(dTo);

            console.log("Filter params:", {
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
                            oView.byId("appr_inpPlant").setValue(sKey);
                            oView.byId("appr_inpPlant").data("selectedKey", sKey);
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
                            oView.byId("appr_inpMatnr").setValue(sKey + " - " + sText);
                            oView.byId("appr_inpMatnr").data("selectedKey", sKey);
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
        // NAVIGATION
        // =========================================================
        onNavHome: function () {
            const oRouter = this.getOwnerComponent().getRouter();
            if (oRouter) {
                MessageToast.show("Back to Dashboard");
                oRouter.navTo("DashBoard");
            }
        },

        onNavReport: function () {
            this.getOwnerComponent().getRouter().navTo("View5");
        },

        // =========================================================
        // DETAIL PANEL
        // =========================================================
        onSelectProposal: function (oEvent) {
            const oContext = oEvent.getParameter("listItem")?.getBindingContext();
            const oDetail = this.byId("appr_detailArea");
            const oLayout = this.byId("appr_layoutMaster");

            if (!oContext) {
                oDetail.setVisible(false);
                oLayout.setSize("100%");
                return;
            }

            if (!oDetail.getVisible()) {
                oDetail.setVisible(true);
                oLayout.setSize("60%");
            }

            oDetail.setModel(this.byId("appr_tblProposal").getModel());
            oDetail.setBindingContext(oContext);

            const oData = oContext.getObject();
            console.log("Selected proposal:", oData.Matnr, oData.Werks, oData.Period);
        },

        onCloseDetail: function () {
            const oDetail = this.byId("appr_detailArea");
            const oLayout = this.byId("appr_layoutMaster");

            oDetail.setVisible(false);
            oLayout.setSize("100%");

            const oTable = this.byId("appr_tblProposal");
            if (oTable) {
                oTable.removeSelections();
            }

            console.log("Detail panel closed");
        },

        // =========================================================
        // SEARCH (Basic search in current page only)
        // =========================================================
        onSearch: function (oEvent) {
            const sQuery = oEvent.getParameter("newValue")?.trim().toUpperCase() || "";

            if (!sQuery) {
                this._loadCurrentPage();
                return;
            }

            MessageToast.show("Searching in current page data...");
        },

        // =========================================================
        // APPROVE / REJECT
        // =========================================================
        onApprove: async function () {
            const aSelected = this.oTable.getSelectedItems();
            if (aSelected.length === 0) {
                MessageToast.show(" Please select at least one proposal.");
                return;
            }

            const that = this;
            const oModel = this.oModel;

            MessageBox.confirm(`Approve ${aSelected.length} proposal(s)?`, {
                onClose: async function (sAction) {
                    if (sAction !== MessageBox.Action.OK) return;

                    sap.ui.core.BusyIndicator.show(0);
                    let iSuccess = 0, iFail = 0;

                    for (const oItem of aSelected) {
                        const oCtx = oItem.getBindingContext();
                        const oData = oCtx.getObject();
                        const sKey = `/ProposalSet(Matnr='${oData.Matnr}',Werks='${oData.Werks}',Period='${oData.Period}')`;

                        oData.Status = "A2";
                        oData.Remark = "Approved by Planner (Level 2)";

                        const oCleanData = (({ Matnr, Werks, Period, Qty, Meins, Status, Remark, PrNumber }) =>
                            ({ Matnr, Werks, Period, Qty, Meins, Status, Remark, PrNumber }))(oData);

                        await new Promise((resolve) => {
                            oModel.update(sKey, oCleanData, {
                                success: function () {
                                    iSuccess++;
                                    console.log("Approved:", oData.Matnr);
                                    resolve();
                                },
                                error: function (err) {
                                    iFail++;
                                    console.error("Approve failed:", err);
                                    resolve();
                                }
                            });
                        });
                    }

                    sap.ui.core.BusyIndicator.hide();
                    MessageBox.success(`Approved ${iSuccess} proposals (${iFail} failed).`);

                    that._loadCurrentPage();
                }
            });
        },

        onReject: async function () {
            const aSelected = this.oTable.getSelectedItems();
            if (aSelected.length === 0) {
                MessageToast.show("Please select at least one proposal.");
                return;
            }

            const that = this;
            const oModel = this.oModel;

            MessageBox.confirm(`Reject ${aSelected.length} proposal(s)?`, {
                onClose: async function (sAction) {
                    if (sAction !== MessageBox.Action.OK) return;

                    sap.ui.core.BusyIndicator.show(0);
                    let iSuccess = 0, iFail = 0;

                    for (const oItem of aSelected) {
                        const oCtx = oItem.getBindingContext();
                        const oData = oCtx.getObject();
                        const sKey = `/ProposalSet(Matnr='${oData.Matnr}',Werks='${oData.Werks}',Period='${oData.Period}')`;

                        oData.Status = "R2";
                        oData.Remark = "Rejected by Planner (Level 2)";

                        const oCleanData = (({ Matnr, Werks, Period, Qty, Meins, Status, Remark }) =>
                            ({ Matnr, Werks, Period, Qty, Meins, Status, Remark }))(oData);

                        await new Promise((resolve) => {
                            oModel.update(sKey, oCleanData, {
                                success: function () {
                                    iSuccess++;
                                    console.log("Rejected:", oData.Matnr);
                                    resolve();
                                },
                                error: function (err) {
                                    iFail++;
                                    console.error("Reject failed:", err);
                                    resolve();
                                }
                            });
                        });
                    }

                    sap.ui.core.BusyIndicator.hide();
                    MessageBox.warning(`Rejected ${iSuccess} proposals (${iFail} failed).`);

                    that._loadCurrentPage();
                }
            });
        },

        // =========================================================
        // ADJUST QTY
        // =========================================================
        onAdjust: function () {
            const aSelected = this.oTable.getSelectedItems();
            if (aSelected.length !== 1) {
                MessageToast.show("Select exactly one proposal to adjust.");
                return;
            }

            const oCtx = aSelected[0].getBindingContext();
            const oData = oCtx.getObject();
            const that = this;

            sap.m.MessageBox.prompt(`Adjust proposal quantity for ${oData.Matnr}`, {
                title: "Adjust Proposal Qty",
                initialValue: oData.Qty.toString(),
                onClose: function (sAction, sValue) {
                    if (sAction !== MessageBox.Action.OK || !sValue) return;

                    const fNewQty = parseFloat(sValue);
                    if (isNaN(fNewQty) || fNewQty <= 0) {
                        MessageBox.error(" Invalid quantity!");
                        return;
                    }

                    const sKey = `/ProposalSet(Matnr='${oData.Matnr}',Werks='${oData.Werks}',Period='${oData.Period}')`;

                    const oUpdateData = {
                        Matnr: oData.Matnr,
                        Werks: oData.Werks,
                        Period: oData.Period,
                        Qty: fNewQty,
                        Meins: oData.Meins,
                        Status: oData.Status,
                        Remark: "Adjusted by planner"
                    };

                    that.oModel.update(sKey, oUpdateData, {
                        success: function () {
                            MessageToast.show(` Quantity adjusted to ${fNewQty}`);
                            that._loadCurrentPage();
                        },
                        error: function (err) {
                            MessageBox.error("Adjust failed!");
                            console.error(err);
                        }
                    });
                }
            });
        },

        // =========================================================
        // CACHE & ENRICH
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
                    console.log("Cached MaterialSet:", oData.results.length);
                },
                error: function (err) {
                    console.error("Failed to load MaterialSet", err);
                    that._oMaterialCache = new JSONModel([]);
                }
            });
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

                const oPlant = aPlants.find(p => normalize(p.Werks) === sWerks);
                const oMat = aMats.find(m => normalize(m.Matnr) === sMatnr);

                return {
                    ...item,
                    PlantName: oPlant ? oPlant.Name1 : "",
                    MaterialName: oMat ? oMat.Maktx : ""
                };
            });
        }
    });
});