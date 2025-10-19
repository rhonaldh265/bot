// index.js
import makeWASocket, {
  useMultiFileAuthState,
  downloadMediaMessage
} from '@whiskeysockets/baileys'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import pino from 'pino'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const AUTH_DIR = path.join(__dirname, 'auth_info')
const SAVED_DIR = path.join(__dirname, 'saved')
const QR_FILE = path.join(__dirname, 'qr.txt')
const MSG_LOG = path.join(SAVED_DIR, 'messages.log')
const MEDIA_LOG = path.join(SAVED_DIR, 'media.log')

export async function startBot() {
  await fs.ensureDir(AUTH_DIR)
  await fs.ensureDir(SAVED_DIR)

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: logger,
    browser: ['Ubuntu', 'Chrome', '22.04.4']
  })

  // Save credentials periodically
  sock.ev.on('creds.update', saveCreds)

  // connection updates — QR handling + reconnect logic
  sock.ev.on('connection.update', (update) => {
    try {
      const { connection, qr } = update
      if (qr) {
        logger.info('QR generated — saving to qr.txt')
        fs.writeFileSync(QR_FILE, qr, 'utf8')
      }

      if (connection === 'open') {
        logger.info('✅ WhatsApp connection open')
        if (fs.pathExistsSync(QR_FILE)) fs.removeSync(QR_FILE) // remove qr after successful login
      }

      if (connection === 'close') {
        logger.warn('❌ Connection closed — attempting restart in 3s')
        setTimeout(() => startBot().catch(e => logger.error(e)), 3000)
      }
    } catch (err) {
      logger.error('connection.update error', err)
    }
  })

  // message upsert: new messages, we save media and log text
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (m.type !== 'notify') return
      const messages = m.messages
      for (const msg of messages) {
        if (!msg.message) continue
        // ignore broadcasts/status
        if (msg.key && msg.key.remoteJid && msg.key.remoteJid.endsWith('@broadcast')) continue

        const jid = msg.key.remoteJid || 'unknown'
        const sender = jid
        const ts = new Date().toISOString()
        const types = Object.keys(msg.message)
        const messageType = types[0]
        logger.info({ jid, messageType }, 'Incoming message')

        // log text messages (helps recover deleted text)
        // different places for text: conversation, extendedTextMessage, imageMessage.caption, etc.
        let text = null
        if (msg.message.conversation) text = msg.message.conversation
        else if (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) text = msg.message.extendedTextMessage.text
        else if (msg.message?.imageMessage?.caption) text = msg.message.imageMessage.caption
        else if (msg.message?.videoMessage?.caption) text = msg.message.videoMessage.caption
        if (text) {
          const line = `${ts} | ${sender} | text | ${text}\n`
          fs.appendFileSync(MSG_LOG, line, 'utf8')
        }

        // media handling: images, video, audio, document, viewOnce variations
        if (['imageMessage','videoMessage','audioMessage','documentMessage'].includes(messageType)) {
          await saveMediaFromMessage(msg, messageType)
        }

        // view-once types can vary: viewOnceMessage or viewOnceMessageV2
        if (messageType === 'viewOnceMessage' || messageType === 'viewOnceMessageV2') {
          // get inner message
          const inner = msg.message[messageType].message
          // inner type may be imageMessage/videoMessage/documentMessage
          const innerType = Object.keys(inner)[0]
          await saveMediaFromMessage({ ...msg, message: inner }, innerType, true)
        }
      }
    } catch (err) {
      logger.error('messages.upsert error', err)
    }
  })

  // optional: listen for message deletion events (Baileys emits message.delete events sometimes)
  sock.ev.on('messages.delete', (info) => {
    try {
      const ts = new Date().toISOString()
      const line = `${ts} | delete-event | ${JSON.stringify(info)}\n`
      fs.appendFileSync(MSG_LOG, line, 'utf8')
      logger.warn('message delete event', info)
    } catch (e) {
      logger.error('messages.delete handler error', e)
    }
  })

  // helper to save media
  async function saveMediaFromMessage(msg, messageType, wasViewOnce = false) {
    try {
      // messageType e.g. 'imageMessage' -> mediaKind 'image'
      const mediaKind = messageType.replace('Message', '').toLowerCase() // image, video, audio, document
      const jid = msg.key.remoteJid || 'unknown'
      const ts = Date.now()
      const jidSafe = jid.replace(/[:@]/g, '_')
      // downloadMediaMessage from Baileys returns a Buffer when passed 'buffer'
      const buffer = await downloadMediaMessage(msg.message[messageType], 'buffer', {}, { logger })
      // choose extension
      let ext = '.bin'
      if (mediaKind === 'image') ext = '.jpg'
      else if (mediaKind === 'video') ext = '.mp4'
      else if (mediaKind === 'audio') ext = '.ogg'
      else if (mediaKind === 'document' && msg.message[messageType].mimetype) {
        const mime = msg.message[messageType].mimetype
        if (mime.includes('pdf')) ext = '.pdf'
        else if (mime.includes('zip')) ext = '.zip'
        else if (mime.includes('png')) ext = '.png'
        else if (mime.includes('jpg') || mime.includes('jpeg')) ext = '.jpg'
      }

      const filename = path.join(SAVED_DIR, `${jidSafe}_${ts}${wasViewOnce ? '_viewonce' : ''}${ext}`)
      await fs.writeFile(filename, buffer)
      const logLine = `${new Date().toISOString()} | ${jid} | ${mediaKind}${wasViewOnce ? ' (view-once)' : ''} | ${filename}\n`
      fs.appendFileSync(MEDIA_LOG, logLine, 'utf8')
      logger.info({ filename, jid }, 'Saved media file')
    } catch (err) {
      logger.error('saveMediaFromMessage error', err)
    }
  }

  // return sock for potential further use
  return sock
}
