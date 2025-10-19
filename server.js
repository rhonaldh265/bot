import express from "express";
import { exec } from "child_process";

const app = express();
const PORT = process.env.PORT || 3000;

// simple web page
app.get("/", (req, res) => {
  res.send("✅ WhatsApp Save Bot is running...");
});

// auto start the bot
exec("node index.js", (error, stdout, stderr) => {
  if (error) {
    console.error(`❌ Bot error: ${error.message}`);
    return;
  }
  if (stderr) console.error(stderr);
  console.log(stdout);
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
