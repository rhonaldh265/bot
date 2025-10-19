import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import express from "express";
import QRCode from "qrcode";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 10000;

// Path to save QR + session data
const SESSION_DIR = "/opt/render/project/src/session";
fs.mkdirSync(SESSION_DIR, { recursive: true });

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false, // disable console QR
  });

  sock.ev.on("connection.update", async (update) => {
    const { qr, connection } = update;

    if (qr) {
      console.log("✅ New QR generated — open /qr in your browser to scan");
      const qrDataUrl = await QRCode.toDataURL(qr);
      fs.writeFileSync(`${SESSION_DIR}/qr.html`, `
        <html>
          <body style="text-align:center; font-family:sans-serif;">
            <h2>Scan this QR with WhatsApp</h2>
            <img src="${qrDataUrl}" style="width:300px;height:300px;"/>
            <p>WhatsApp → Linked Devices → Link a device</p>
          </body>
        </html>
      `);
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected successfully!");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // Simple web route to show QR
  app.get("/qr", (req, res) => {
    const qrPath = `${SESSION_DIR}/qr.html`;
    if (fs.existsSync(qrPath)) {
      res.sendFile(qrPath);
    } else {
      res.send("<h3>No QR code available. The bot may already be logged in.</h3>");
    }
  });

  app.get("/", (req, res) => {
    res.send("<h2>Bot is running ✅ — go to /qr to scan if not yet paired.</h2>");
  });

  app.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));
}

start().catch(err => console.error("❌ Startup error:", err));
