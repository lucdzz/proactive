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

        onInit: function () {
            this.oModel = this.getOwnerComponent().getModel();
            this.oTable = this.byId("appr_tblProposal");

            this.oModel.metadataLoaded().then(() => {
                this._loadPlantAndMaterialCache();
                this.loadPendingProposals();
            });

        },


        // =========================================================
        // NAVIGATION
        // =========================================================
        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("DashBoard");
        },

        onNavReport: function () {
            this.getOwnerComponent().getRouter().navTo("View5");
        },

        // =========================================================
        // LOAD PENDING PROPOSALS
        // =========================================================
        loadPendingProposals: function () {
            const that = this;
            this.oTable.setBusy(true);

            this.oModel.read("/ProposalSet", {
                filters: [new Filter("Status", FilterOperator.EQ, "A1")],
                success: function (oData) {
                    const aEnriched = that._enrichWithNames(oData.results);
                    const oJSON = new JSONModel(aEnriched);
                    that.oTable.setModel(oJSON);
                    that.oTable.bindItems({
                        path: "/",
                        template: that.oTable.getBindingInfo("items").template.clone()
                    });
                    that.oTable.setBusy(false);
                },
                error: function (oError) {
                    that.oTable.setBusy(false);
                    MessageBox.error("❌ Failed to load pending proposals.");
                    console.error(oError);
                }
            });
        },

        // =========================================================
        // SEARCH FILTER
        // =========================================================
        onSearch: function (oEvent) {
            const sQuery = oEvent.getParameter("newValue");
            const oBinding = this.oTable.getBinding("items");

            if (sQuery && sQuery.length > 0) {
                const aFilters = [
                    new Filter("Matnr", FilterOperator.Contains, sQuery),
                    new Filter("Werks", FilterOperator.Contains, sQuery)
                ];
                oBinding.filter(new Filter({ filters: aFilters, and: false }));
            } else {
                oBinding.filter([]);
            }
        },

        // =========================================================
        // APPROVE / REJECT
        // =========================================================
        onApprove: async function () {
            const aSelected = this.oTable.getSelectedItems();
            if (aSelected.length === 0) {
                MessageToast.show("⚠️ Please select at least one proposal.");
                return;
            }

            const that = this;
            const oModel = this.oModel;

            MessageBox.confirm(`Approve ${aSelected.length} proposal(s)?`, {
                onClose: async function (sAction) {
                    if (sAction !== "OK") return;

                    let iSuccess = 0, iFail = 0;

                    for (const oItem of aSelected) {
                        const oCtx = oItem.getBindingContext();
                        const oData = oCtx.getObject();
                        const sKey = `/ProposalSet(Matnr='${oData.Matnr}',Werks='${oData.Werks}',Period='${oData.Period}')`;

                        // 🔹 Cập nhật trạng thái duyệt
                        oData.Status = "A2";
                        oData.Remark = "Approved by Planner (Level 2)";

                        // 🔹 Chỉ lấy các field backend cho phép
                        const oCleanData = (({ Matnr, Werks, Period, Qty, Meins, Status, Remark }) =>
                            ({ Matnr, Werks, Period, Qty, Meins, Status, Remark }))(oData);

                        // 🔹 Gửi lên OData
                        await new Promise((resolve) => {
                            oModel.update(sKey, oCleanData, {
                                success: function () {
                                    iSuccess++;
                                    resolve();
                                },
                                error: function (err) {
                                    iFail++;
                                    console.error("❌ Approve failed:", err);
                                    resolve();
                                }
                            });
                        });
                    }

                    MessageBox.success(`✅ Approved ${iSuccess} proposals (${iFail} failed).`);
                    that.loadPendingProposals();
                }
            });
        },
        onReject: async function () {
            const aSelected = this.oTable.getSelectedItems();
            if (aSelected.length === 0) {
                MessageToast.show("⚠️ Please select at least one proposal.");
                return;
            }

            const that = this;
            const oModel = this.oModel;

            MessageBox.confirm(`Reject ${aSelected.length} proposal(s)?`, {
                onClose: async function (sAction) {
                    if (sAction !== "OK") return;

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
                                    resolve();
                                },
                                error: function (err) {
                                    iFail++;
                                    console.error("❌ Reject failed:", err);
                                    resolve();
                                }
                            });
                        });

                    }

                    MessageBox.warning(`⚠️ Rejected ${iSuccess} proposals (${iFail} failed).`);
                    that.loadPendingProposals();
                }
            });
        },

        // =========================================================
        // ADJUST QTY (demo dialog)
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

            MessageBox.prompt(`Adjust proposal quantity for ${oData.Matnr}`, {
                title: "Adjust Proposal Qty",
                defaultValue: oData.Qty,
                onClose: function (sValue) {
                    if (!sValue) return;

                    const sKey = `/ProposalSet(Matnr='${oData.Matnr}',Werks='${oData.Werks}',Period='${oData.Period}')`;
                    oData.Qty = parseFloat(sValue);
                    oData.Remark = "Adjusted by planner";

                    that.oModel.update(sKey, oData, {
                        success: () => MessageToast.show("✅ Quantity adjusted"),
                        error: (err) => MessageBox.error("❌ Adjust failed")
                    });
                }
            });
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

        // =========================================================
        // FORMATTERS
        // =========================================================
        formatStatusText: function (sStatus) {
            switch (sStatus) {
                case "A1": return "⏳ Đang chờ phê duyệt cấp 2";
                case "A2": return "✅ Duyệt thành công";
                case "R1": return "❌ Từ chối cấp 1";
                case "R2": return "❌ Từ chối cấp 2";
                case "N": return "🕓 Chưa gửi đề xuất";
                default: return sStatus;
            }
        },
        formatStatusState: function (sStatus) {
            switch (sStatus) {
                case "A1": return "Warning";
                case "A2": return "Success";
                case "R1":
                case "R2": return "Error";
                default: return "None";
            }
        }

    });
});
