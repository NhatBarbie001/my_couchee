const {Server} = require("socket.io");

module.exports = {
  name: "socket",
  settings: {
    port: 3001,
  },
  dependencies: [
    "settings"
  ],



  async started() {

    // Khởi tạo Socket.IO server
    this.io = new Server(this.settings.port, {
      transports: ["websocket"],
      path: "/socket",
    });

    // ---- Role Play Namespace ----
    this.io.of("/roleplay").on("connection", async (socket) => {
      this.logger.info(`RolePlay client connected: ${socket.id}`);

      // Chuyển việc xử lý socket sang roleplaysessions.service.js
      this.broker.emit("roleplay.client.connected", socket);
    });
    // ---- End Role Play Namespace ----

    // ---- Gemini Live Namespace ----
    this.io.of("/gemini-live").on("connection", async (socket) => {
      this.logger.info(`GeminiLive client connected: ${socket.id}`);

      // Chuyển việc xử lý socket sang geminilive.service.js
      this.broker.emit("geminilive.client.connected", socket);
    });
    // ---- End Gemini Live Namespace ----

    this.logger.info("Socket.IO server is running...");
  },

  stopped() {
    if (this.io) {
      console.log("Shutting down WebSocket server...");
      this.io.close();
    }
  },
};
