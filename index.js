import makeWASocket, {
  useMultiFileAuthState,
  downloadMediaMessage
} from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import fs from 'fs-extra'

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message) return

    const from = msg.key.remoteJid
    const type = Object.keys(msg.message)[0]
    console.log(`📩 New message type: ${type}`)

    // handle view-once
    if (type === 'viewOnceMessageV2') {
      const mediaMsg = msg.message.viewOnceMessageV2.message
      const buffer = await downloadMediaMessage(
        { message: mediaMsg },
        'buffer',
        {},
        { logger: console }
      )

      fs.ensureDirSync('saved')
      const filename = `saved/${Date.now()}.jpg`
      fs.writeFileSync(filename, buffer)
      console.log(`✅ View-once media saved: ${filename}`)
    }
  })

  sock.ev.on('messages.delete', (info) => {
    console.log('❌ Message deleted:', info)
  })
}

startBot()
