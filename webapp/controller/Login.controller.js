sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/ui/core/BusyIndicator",
    "sap/ui/model/json/JSONModel"
], function (Controller, MessageToast, BusyIndicator, JSONModel) {
    "use strict";

    return Controller.extend("zpg.mrp.ui.controller.Login", {

        onLogin: function () {
            const sUser = this.byId("inpUser").getValue().trim();
            const sPass = this.byId("inpPass").getValue().trim();

            if (!sUser || !sPass) {
                return MessageToast.show("Vui lòng nhập đầy đủ thông tin!");
            }

            // 🔹 Bật mock mode nếu không kết nối được OData
            const bMockMode = true; // 👉 đổi về false khi deploy lên SAP
            if (bMockMode) {
                const aMockUsers = [
                    {
                        Username: "QLKHO",
                        Password: "123",
                        Role: "L1",
                        Fullname: "Nguyễn Thế Lực",
                        Email: "lucnthe173098@fpt.edu.vn"
                    },
                    {
                        Username: "QLMH",
                        Password: "123",
                        Role: "L2",
                        Fullname: "Nguyễn Mạnh Dũng",
                        Email: "dungnmhe173094@fpt.edu.vn"
                    }
                ];

                const oMockModel = new JSONModel({ results: aMockUsers });
                const oData = oMockModel.getData();

                // ✅ Mô phỏng kiểm tra login
                const user = oData.results.find(u => u.Username === sUser && u.Password === sPass);

                BusyIndicator.hide();

                if (!user) {
                    return MessageToast.show("⚠️ Sai tài khoản hoặc mật khẩu!");
                }

                // 🔹 Lưu thông tin user vào localStorage
                localStorage.setItem("MRP_USERNAME", user.Username);
                localStorage.setItem("MRP_ROLE", user.Role);
                localStorage.setItem("MRP_FULLNAME", user.Fullname);

                MessageToast.show(`✅ Xin chào ${user.Fullname}!`);
                this.getOwnerComponent().getRouter().navTo("DashBoard");
                return;
            }

            // 🔹 Nếu không ở mock mode → gọi OData thật
            const oModel = this.getOwnerComponent().getModel();
            const sPath = `/UserSet?$filter=Username eq '${sUser}' and Password eq '${sPass}'`;

            BusyIndicator.show(0);

            oModel.read(sPath, {
                success: (oData) => {
                    BusyIndicator.hide();

                    if (oData.results.length === 0) {
                        MessageToast.show("Sai tài khoản hoặc mật khẩu!");
                        return;
                    }

                    const user = oData.results[0];

                    localStorage.setItem("MRP_USERNAME", user.Username);
                    localStorage.setItem("MRP_ROLE", user.Role);
                    localStorage.setItem("MRP_FULLNAME", user.Fullname);

                    MessageToast.show(`Xin chào ${user.Fullname}!`);
                    this.getOwnerComponent().getRouter().navTo("DashBoard");
                },
                error: (err) => {
                    BusyIndicator.hide();
                    console.error("Login OData Error:", err);
                    MessageToast.show("❌ Không thể kết nối đến OData Service!", { at: "center center" });
                }
            });
        }
    });
});
