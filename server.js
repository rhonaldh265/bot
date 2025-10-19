// server.js
import express from 'express'
import fs from 'fs'
import path from 'path'
import { startBot } from './index.js'

const app = express()
const PORT = process.env.PORT || 10000
const QR_FILE = 'qr.txt'

// start the WhatsApp bot (non-blocking)
startBot().catch(err => {
  console.error('Bot failed to start:', err)
})

// root
app.get('/', (req, res) => {
  res.send(`<center><h2>✅ WhatsApp Save Bot is running</h2><p>Visit <a href="/qr">/qr</a> to scan the login QR (if available).</p></center>`)
})

// QR page: renders a QR image created from the raw QR string saved to qr.txt
app.get('/qr', (req, res) => {
  try {
    if (fs.existsSync(QR_FILE)) {
      const qr = fs.readFileSync(QR_FILE, 'utf8')
      // use external quick QR generation (no extra package)
      const imgUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`
      res.send(`<center><h3>Scan this QR with WhatsApp → Linked devices → Link a device</h3><img src="${imgUrl}" alt="QR Code"/></center>`)
    } else {
      res.send(`<center><h3>No QR available yet. If the bot is not logged in, wait a few seconds and refresh.</h3></center>`)
    }
  } catch (err) {
    res.status(500).send('Error reading QR file.')
  }
})

// list saved files (optional — simple listing)
app.get('/files', (req, res) => {
  try {
    const savedDir = path.join(process.cwd(), 'saved')
    if (!fs.existsSync(savedDir)) return res.send('<p>No saved files yet</p>')
    const files = fs.readdirSync(savedDir)
    const html = files.map(f => `<li><a href="/download/${encodeURIComponent(f)}">${f}</a></li>`).join('')
    res.send(`<h3>Saved files</h3><ul>${html}</ul>`)
  } catch (e) {
    res.status(500).send('error')
  }
})

app.get('/download/:file', (req, res) => {
  const file = req.params.file
  const filePath = path.join(process.cwd(), 'saved', file)
  if (fs.existsSync(filePath)) {
    res.download(filePath)
  } else {
    res.status(404).send('Not found')
  }
})

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`)
})
