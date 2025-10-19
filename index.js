// index.js
import makeWASocket, {
  useMultiFileAuthState,
  downloadContentFromMessage,
  WAMessageStubType
} from '@whiskeysockets/baileys'
import fs from 'fs-extra'
import path from 'path'

const AUTH_DIR = './auth_info'
const QR_FILE = 'qr.txt'
const SAVE_DIR = './saved'
const LOG_DIR = './logs'

// ensure folders exist
fs.ensureDirSync(AUTH_DIR)
fs.ensureDirSync(SAVE_DIR)
fs.ensureDirSync(LOG_DIR)

/**
 * Helper: write QR to disk (so server can show it)
 */
function saveQr(qr) {
  try {
    fs.writeFileSync(QR_FILE, qr, 'utf8')
    console.log('🧾 QR saved to', QR_FILE)
  } catch (e) {
    console.error('Failed to write QR:', e)
  }
}

/**
 * Helper: delete QR file (after successful connect)
 */
function removeQr() {
  try {
    if (fs.existsSync(QR_FILE)) fs.unlinkSync(QR_FILE)
  } catch (e) {
    // ignore
  }
}

/**
 * Save metadata log
 */
function appendLog(filename, line) {
  fs.appendFileSync(path.join(LOG_DIR, filename), line + '\n', 'utf8')
}

/**
 * Download and save a media message (image, video, audio, document).
 * messageContent is the message object for the media (e.g., msg.message.imageMessage)
 */
async function saveMedia(msgKey, messageContent, mediaType) {
  try {
    const stream = await downloadContentFromMessage(messageContent, mediaType)
    // build filename
    const timestamp = Date.now()
    let ext = '.bin'
    if (mediaType === 'image') ext = '.jpg'
    if (mediaType === 'video') ext = '.mp4'
    if (mediaType === 'audio') ext = '.ogg'
    // for document, try to use mimetype extension if present
    if (mediaType === 'document' && messageContent.mimetype) {
      const mime = messageContent.mimetype
      if (mime.includes('pdf')) ext = '.pdf'
      else if (mime.includes('png')) ext = '.png'
      else if (mime.includes('zip')) ext = '.zip'
      else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg'
    }

    const jidSafe = (msgKey.remoteJid || 'unknown').replace(/[:@]/g, '_')
    const filename = path.join(SAVE_DIR, `${jidSafe}_${timestamp}${ext}`)
    const writeStream = fs.createWriteStream(filename)

    for await (const chunk of stream) {
      writeStream.write(chunk)
    }
    writeStream.end()

    const meta = `${new Date().toISOString()} | ${msgKey.remoteJid} | ${mediaType} | ${filename}`
    appendLog('media.log', meta)
    console.log('✅ Saved media to', filename)
    return filename
  } catch (err) {
    console.error('Error saving media:', err)
    appendLog('errors.log', `${new Date().toISOString()} | saveMedia error | ${err.message}`)
    return null
  }
}

/**
 * Start the bot: exported so server.js can call it.
 */
export async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['WhatsAppSaveBot', 'Web', '1.0.0']
    })

    // save QR when generated and write to disk for server to serve
    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update

      if (qr) {
        console.log('🧾 QR generated — saved to file for /qr page')
        saveQr(qr)
      }

      if (connection === 'open') {
        console.log('✅ WhatsApp bot connected!')
        removeQr() // remove QR after successful login
        appendLog('events.log', `${new Date().toISOString()} | connected`)
      }

      if (connection === 'close') {
        appendLog('events.log', `${new Date().toISOString()} | disconnected`)
        console.log('❌ Connection closed — attempting restart in 3s')
        // Try reconnect with small delay
        setTimeout(() => startBot().catch(e => {
          console.error('Restart failed:', e)
          appendLog('errors.log', `${new Date().toISOString()} | restart failed | ${e.message}`)
        }), 3000)
      }

      if (lastDisconnect && lastDisconnect.error) {
        appendLog('events.log', `${new Date().toISOString()} | lastDisconnect | ${JSON.stringify(lastDisconnect.error?.output || lastDisconnect.error)}`)
      }
    })

    // persist credentials on update
    sock.ev.on('creds.update', saveCreds)

    // handle incoming messages
    sock.ev.on('messages.upsert', async (m) => {
      try {
        if (m.type !== 'notify') return
        const messages = m.messages
        for (const msg of messages) {
          if (!msg.message) continue
          // avoid broadcast
          if (msg.key && msg.key.remoteJid && msg.key.remoteJid.endsWith('@broadcast')) continue

          const messageType = Object.keys(msg.message)[0]
          console.log('📩 received type:', messageType, 'from:', msg.key.remoteJid)

          // Save text messages to log so you can see deleted text later
          let text = ''
          if (msg.message.conversation) text = msg.message.conversation
          else if (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) text = msg.message.extendedTextMessage.text
          if (text) {
            const line = `${new Date().toISOString()} | ${msg.key.remoteJid} | text | ${text}`
            appendLog('messages.log', line)
          }

          // Media types (imageMessage, videoMessage, audioMessage, documentMessage)
          if (['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(messageType)) {
            const mediaKind = messageType.replace('Message', '').toLowerCase() // image, video, audio, document
            const content = msg.message[messageType]
            await saveMedia(msg.key, content, mediaKind)
          }

          // viewOnce types: older/newer lips — handle both possible keys
          if (messageType === 'viewOnceMessage' || messageType === 'viewOnceMessageV2') {
            // viewOnceMessageV2 structure: { viewOnceMessageV2: { message: { imageMessage: { ... } } } }
            const viewKey = msg.message[messageType]
            let inner = viewKey.message || viewKey
            // inner might contain imageMessage, videoMessage, etc.
            const innerType = Object.keys(inner)[0]
            if (innerType) {
              await saveMedia(msg.key, inner[innerType], innerType.replace('Message', '').toLowerCase())
            }
          }
        }
      } catch (err) {
        console.error('messages.upsert error:', err)
        appendLog('errors.log', `${new Date().toISOString()} | messages.upsert error | ${err.message}`)
      }
    })

    // log deletes (Baileys may provide key info in "messages.delete" or stubTypes)
    sock.ev.on('messages.delete', (info) => {
      console.log('❌ messages.delete event:', info)
      appendLog('events.log', `${new Date().toISOString()} | message.delete | ${JSON.stringify(info)}`)
    })

    // also listen for message stubs (for deletions or edits)
    sock.ev.on('message-receipt.update', (r) => {
      // optional: log receipts
    })

    // return the socket in case caller wants to use it
    return sock
  } catch (err) {
    console.error('startBot error:', err)
    appendLog('errors.log', `${new Date().toISOString()} | startBot error | ${err.message}`)
    throw err
  }
}
