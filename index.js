/**
 * index.js
 * - Connects to WhatsApp using Baileys
 * - Saves incoming media to /saved/
 * - Logs text and media metadata
 * - Writes a 'qr.txt' file when a new QR is generated (server.js will render it)
 */

import makeWASocket, {
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason
} from '@whiskeysockets/baileys'
import fs from 'fs-extra'
import path from 'path'

const AUTH_DIR = './auth_info'   // directory where Baileys stores auth files
const SAVED_DIR = './saved'      // where media and logs are saved
const QR_FILE = './qr.txt'       // temporary QR file for server to show

// ensure dirs exist
fs.ensureDirSync(SAVED_DIR)

// helper: safe filename
function safeFilename(input) {
  return input.replace(/[:\/\\<>|?*\x00-\x1F]/g, '_')
}

export async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['RenderBot', 'Chrome', '22.04.4']
    })

    // Save credentials when updated
    sock.ev.on('creds.update', saveCreds)

    // connection updates: QR generation, connected, closed
    sock.ev.on('connection.update', (update) => {
      const { connection, qr } = update

      if (qr) {
        console.log('🧾 New QR generated; saved to qr.txt (open /qr to scan).')
        fs.writeFileSync(QR_FILE, qr, 'utf8')
      }

      if (connection === 'open') {
        console.log('✅ WhatsApp bot connected successfully.')
        // remove qr file if exists
        if (fs.existsSync(QR_FILE)) fs.unlinkSync(QR_FILE)
      }

      if (connection === 'close') {
        console.warn('❌ Connection closed. Attempting reconnect...')
        // optionally examine reason and restart
        // some errors require deleting auth_info to re-pair; we attempt restart
        setTimeout(() => {
          try {
            startBot() // attempt restart
          } catch (e) {
            console.error('Reconnection attempt failed:', e)
          }
        }, 2000)
      }
    })

    // handle incoming messages
    sock.ev.on('messages.upsert', async (upsert) => {
      try {
        if (upsert.type !== 'notify') return
        const msgs = upsert.messages
        for (const msg of msgs) {
          if (!msg.message) continue
          // skip broadcast or status-type messages if desired
          const jid = msg.key?.remoteJid ?? 'unknown'
          const sender = jid
          const t = new Date().toISOString()

          // Log text messages
          // text can be in different fields; handle common ones
          let text = null
          if (msg.message.conversation) text = msg.message.conversation
          else if (msg.message.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text

          if (text) {
            const line = `${t} | ${sender} | text | ${text}\n`
            fs.appendFileSync(path.join(SAVED_DIR, 'messages.log'), line, 'utf8')
            console.log('📝 Text saved:', text)
          }

          // Detect message type
          const messageType = Object.keys(msg.message)[0]

          // Media types (imageMessage, videoMessage, audioMessage, documentMessage, viewOnceMessageV2, etc.)
          if (['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(messageType)) {
            // standard media
            await saveMedia(msg, messageType)
          } else if (messageType === 'viewOnceMessageV2' || messageType === 'viewOnceMessage') {
            // view-once wrapper; find inner message
            const inner = msg.message[messageType].message
            // inner might be imageMessage, videoMessage, etc.
            const innerType = Object.keys(inner)[0]
            await saveMedia({ ...msg, message: inner }, innerType, true)
          }
        }
      } catch (err) {
        console.error('Error in messages.upsert handler:', err)
      }
    })

    // optional: log deletes (Baileys emits 'messages.delete' events)
    sock.ev.on('messages.delete', (del) => {
      // del may contain keys of deleted messages
      const line = `${new Date().toISOString()} | deleted | ${JSON.stringify(del)}\n`
      fs.appendFileSync(path.join(SAVED_DIR, 'messages.log'), line, 'utf8')
      console.log('🗑️ Message deleted event logged.')
    })

    // helper: save media
    async function saveMedia(msg, messageType, isViewOnce = false) {
      try {
        const mediaKind = messageType.replace('Message', '').toLowerCase() // e.g., image, video, audio, document
        const stream = await downloadMediaMessage(msg.message[messageType], 'buffer', {}, { logger: console })
        const timestamp = Date.now()
        let ext = '.bin'
        if (mediaKind === 'image') ext = '.jpg'
        if (mediaKind === 'video') ext = '.mp4'
        if (mediaKind === 'audio') ext = '.ogg'
        if (mediaKind === 'document' && msg.message[messageType].mimetype) {
          const mime = msg.message[messageType].mimetype
          if (mime.includes('pdf')) ext = '.pdf'
          else if (mime.includes('zip')) ext = '.zip'
          else if (mime.includes('png')) ext = '.png'
          else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg'
        }

        const jidSafe = safeFilename(msg.key.remoteJid || 'unknown')
        const filename = path.join(SAVED_DIR, `${jidSafe}_${timestamp}${ext}`)
        fs.writeFileSync(filename, stream)
        const logLine = `${new Date().toISOString()} | ${msg.key.remoteJid} | ${isViewOnce ? 'view-once|' : ''}${mediaKind} | ${filename}\n`
        fs.appendFileSync(path.join(SAVED_DIR, 'media.log'), logLine, 'utf8')
        console.log(`✅ Saved media (${mediaKind}) -> ${filename}`)
      } catch (err) {
        console.error('Error saving media:', err)
      }
    }

    return sock
  } catch (err) {
    console.error('startBot error:', err)
    throw err
  }
}
