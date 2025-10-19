import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys'
import fs from 'fs'

export async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')
  const sock = makeWASocket({
    printQRInTerminal: false, // no terminal QR
    auth: state,
    browser: ['Ubuntu', 'Chrome', '22.04.4']
  })

  // Event: Save QR for the web
  sock.ev.on('connection.update', ({ connection, qr }) => {
    if (qr) {
      console.log('🧾 QR code generated. Open /qr to scan.')
      fs.writeFileSync('qr.txt', qr)
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp bot connected successfully!')
      if (fs.existsSync('qr.txt')) fs.unlinkSync('qr.txt') // remove QR after login
    }

    if (connection === 'close') {
      console.log('❌ Connection closed. Reconnecting...')
      startBot() // auto-restart
    }
  })

  sock.ev.on('creds.update', saveCreds)
}
