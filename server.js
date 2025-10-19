import express from 'express'
import fs from 'fs'
import { startBot } from './index.js'

const app = express()
const PORT = process.env.PORT || 10000

// Start the WhatsApp bot
startBot()

// Route: Display QR code
app.get('/qr', (req, res) => {
  if (fs.existsSync('qr.txt')) {
    const qr = fs.readFileSync('qr.txt', 'utf-8')
    res.send(`
      <center>
        <h2>📱 Scan this QR to link your WhatsApp</h2>
        <img src="https://api.qrserver.com/v1/create-qr-code/?data=${qr}&size=300x300" />
      </center>
    `)
  } else {
    res.send('<center><h3>No QR available yet. Please wait...</h3></center>')
  }
})

// Default route
app.get('/', (req, res) => {
  res.send('<center><h2>✅ Bot is running! Visit /qr to scan WhatsApp QR</h2></center>')
})

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`)
})
