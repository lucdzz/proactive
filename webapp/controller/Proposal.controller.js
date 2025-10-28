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
        // =========================================================
        // INIT – Auto load proposals on page open
        // =========================================================
        onInit: function () {
            this.oModel = this.getOwnerComponent().getModel();
            this.oTable = this.byId("prop_tblProposal");

            const that = this;
            this.oModel.metadataLoaded().then(function () {
                that._loadPlantAndMaterialCache();
                that._autoLoadProposals();
            });
        },

        // =========================================================
        // AUTO LOAD FROM BACKEND
        // =========================================================
        _autoLoadProposals: function () {
            const that = this;
            sap.ui.core.BusyIndicator.show(0);

            this.oModel.read("/MRPDiffSet", {
                filters: [new Filter("QtyNet", FilterOperator.LT, 0)],
                success: function (oData) {
                    sap.ui.core.BusyIndicator.hide();

                    if (!oData.results || oData.results.length === 0) {
                        MessageBox.warning("No shortage data found (Net < 0).");
                        that._aAllProposals = [];
                        that._updatePage();
                        return;
                    }
                    const enriched = that._enrichWithNames(oData.results);
                    that._aAllProposals = enriched.map(r => ({
                        Matnr: r.Matnr,
                        MaterialName: r.MaterialName,
                        Werks: r.Werks,
                        PlantName: r.PlantName,
                        Qty: Math.abs(r.QtyNet),
                        Meins: r.Meins,
                        Period: r.Period,
                        Status: "A1",
                        Remark: "Submitted by Warehouse (Level 1)"
                    }));

                    // that._aAllProposals = oData.results.map(r => ({
                    //     Matnr: r.Matnr,
                    //     Werks: r.Werks,
                    //     Qty: Math.abs(r.QtyNet),
                    //     Meins: r.Meins,
                    //     Period: r.Period,
                    //     Status: "A1",
                    //     Remark: "Submitted by Warehouse (Level 1)"
                    // }));

                    that._pageSize = 10;
                    that._currentPage = 1;
                    that._totalPages = Math.max(1, Math.ceil(that._aAllProposals.length / that._pageSize));

                    that._updatePage();

                    MessageToast.show(`✅ Loaded ${that._aAllProposals.length} proposal records`);
                },
                error: function (err) {
                    sap.ui.core.BusyIndicator.hide();
                    console.error("❌ Auto load failed:", err);
                    MessageBox.error("Failed to load proposal data from backend.");
                }
            });
        },

        // =========================================================
        // NAVIGATION
        // =========================================================
        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("DashBoard");
        },

        onNavApproval: function () {
            this.getOwnerComponent().getRouter().navTo("Approval");
        },

        // =========================================================
        // GENERATE (Refresh proposals manually)
        // =========================================================
        onGenerate: function () {
            const that = this;
            MessageToast.show("🔄 Generating proposals from MRP Diff (Net < 0)...");
            this.oTable.setBusy(true);

            // ✅ Gọi OData có filter để backend biết đây là UC03
            this.oModel.read("/MRPDiffSet", {
                // urlParameters: {
                //     "$filter": "ShowShortageOnly eq true"
                // },
                filters: [new Filter("QtyNet", FilterOperator.LT, 0)],
                success: function (oData) {
                    that.oTable.setBusy(false);

                    if (!oData.results || oData.results.length === 0) {
                        MessageBox.warning("No shortages (Net < 0) found!");
                        return;
                    }

                    // ✅ Chuẩn hoá data
                    that._aAllProposals = oData.results.map(r => ({
                        Matnr: r.Matnr,
                        Werks: r.Werks,
                        Qty: Math.abs(r.QtyNet),
                        Meins: r.Meins,
                        Period: r.Period,
                        Status: "N",
                        Remark: ""
                    }));

                    // ✅ Phân trang
                    that._pageSize = 10;
                    that._currentPage = 1;
                    that._totalPages = Math.max(1, Math.ceil(that._aAllProposals.length / that._pageSize));
                    that._updatePage();

                    MessageBox.success(`✅ Generated ${that._aAllProposals.length} proposals.`);
                },
                error: function (oError) {
                    that.oTable.setBusy(false);
                    console.error("❌ Proposal generation error:", oError);
                    MessageBox.error("Failed to load shortage data from backend.");
                }
            });
        },
        // =========================================================
        // SAVE SELECTED PROPOSALS TO SAP
        // =========================================================
        onSaveProposal: async function () {
            const aSelected = this.oTable.getSelectedItems();
            if (aSelected.length === 0) {
                sap.m.MessageToast.show("⚠️ Please select at least one proposal to save.");
                return;
            }

            const that = this;
            const oModel = this.oModel;
            let iCreated = 0, iUpdated = 0, iFailed = 0;

            sap.m.MessageBox.confirm(`💾 Save ${aSelected.length} selected proposal(s) to SAP?`, {
                onClose: async function (sAction) {
                    if (sAction !== "OK") return;

                    that.oTable.setBusy(true);

                    for (const oItem of aSelected) {
                        const oData = oItem.getBindingContext().getObject();
                        const sKey = `/ProposalSet(Matnr='${oData.Matnr}',Werks='${oData.Werks}',Period='${oData.Period}')`;

                        // chuẩn hóa kiểu dữ liệu
                        oData.Qty = String(oData.Qty);
                        oData.Status = "A1"; // gửi lên cấp 1 phê duyệt
                        oData.Remark = "Submitted by Warehouse (Level 1)";
                        const oCleanData = (({ Matnr, Werks, Period, Qty, Meins, Status, Remark }) =>
                            ({ Matnr, Werks, Period, Qty, Meins, Status, Remark }))(oData);

                        // kiểm tra tồn tại -> update / create
                        await new Promise((resolve) => {
                            oModel.read(sKey, {
                                success: function () {
                                    oModel.update(sKey, oCleanData, {
                                        success: function () { iUpdated++; resolve(); },
                                        error: function (err) { iFailed++; console.error(err); resolve(); }
                                    });
                                },
                                error: function () {
                                    oModel.create("/ProposalSet", oCleanData, {
                                        success: function () { iCreated++; resolve(); },
                                        error: function (err) { iFailed++; console.error(err); resolve(); }
                                    });
                                }
                            });
                        });
                    }

                    that.oTable.setBusy(false);
                    let sMsg = `💾 Saved proposals: ${iCreated} created, ${iUpdated} updated`;
                    if (iFailed > 0) {
                        sMsg += `, ${iFailed} failed ❌`;
                        sap.m.MessageBox.warning(sMsg);
                    } else {
                        sap.m.MessageBox.success(sMsg);
                    }

                    // reload data nếu cần
                    that._autoLoadProposals();
                }
            });
        },

        // =========================================================
        // PAGINATION
        // =========================================================
        _updatePage: function () {
            if (!this._aAllProposals || this._aAllProposals.length === 0) {
                this.oTable.setModel(new JSONModel([]));
                this.byId("prop_txtPageInfo").setText("No data");
                return;
            }

            const iStart = (this._currentPage - 1) * this._pageSize;
            const iEnd = iStart + this._pageSize;
            const aPageData = this._aAllProposals.slice(iStart, iEnd);

            this.byId("prop_txtPageInfo").setText(
                `Page ${this._currentPage} / ${this._totalPages}`
            );

            // 🔹 Gán model mới
            const oJSON = new JSONModel(aPageData);
            this.oTable.setModel(oJSON);

            // 🔹 Clone template trực tiếp từ XML ID (vì bạn có sẵn prop_rowTemplate)
            const oTemplate = new sap.m.ColumnListItem({
                type: "Active",
                cells: [
                    new sap.m.Text({ text: "{Matnr} - {MaterialName}" }),
                    new sap.m.Text({ text: "{Werks} - {PlantName}" }),
                    new sap.m.Input({ value: "{Qty}", type: "Number", width: "90px" }),
                    new sap.m.Text({ text: "{Meins}" }),
                    new sap.m.Text({ text: "{Period}" }),
                    new sap.m.ObjectStatus({
                        text: { path: "Status", formatter: this.formatStatusText },
                        state: { path: "Status", formatter: this.formatStatusState },
                        icon: { path: "Status", formatter: this.formatStatusIcon }
                    }),
                    new sap.m.Input({ value: "{Remark}", width: "200px", placeholder: "Enter note..." })
                ]
            });

            this.oTable.unbindItems();
            this.oTable.bindItems("/", oTemplate);
        },

        _loadPlantAndMaterialCache: function () {
            const oModel = this.oModel;
            const that = this;

            oModel.read("/PlantSet", {
                success: function (oData) {
                    that._oPlantCache = new JSONModel(oData.results);
                    console.log("✅ Cached PlantSet:", oData.results.length);
                },
                error: function (err) {
                    console.error("❌ Failed to load PlantSet", err);
                }
            });

            oModel.read("/MaterialSet", {
                success: function (oData) {
                    that._oMaterialCache = new JSONModel(oData.results);
                    console.log("✅ Cached MaterialSet:", oData.results.length);
                },
                error: function (err) {
                    console.error("❌ Failed to load MaterialSet", err);
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
        },

        formatStatusText: function (sStatus) {
            switch (sStatus) {
                case "N": return "New";
                case "A1": return "Submitted (L1)";
                case "A2": return "Approved (L2)";
                case "R2": return "Rejected (L2)";
                default: return "";
            }
        },
        formatStatusState: function (sStatus) {
            switch (sStatus) {
                case "N": return "None";
                case "A1": return "Warning";
                case "A2": return "Success";
                case "R2": return "Error";
                default: return "None";
            }
        },
        formatStatusIcon: function (sStatus) {
            switch (sStatus) {
                case "N": return "sap-icon://create";
                case "A1": return "sap-icon://pending";
                case "A2": return "sap-icon://accept";
                case "R2": return "sap-icon://decline";
                default: return "";
            }
        },
        // =========================================================
        // HELPER
        // =========================================================
        _finishSave: function (iCreated, iUpdated, iFailed) {
            this.oTable.setBusy(false);

            let sMsg = `💾 Sync complete: ${iCreated} created, ${iUpdated} updated`;
            if (iFailed > 0) {
                sMsg += `, ${iFailed} failed ❌`;
                MessageBox.warning(sMsg);
            } else {
                MessageBox.success(sMsg);
            }
        }

    });
});
