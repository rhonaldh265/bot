// index.js
require('dotenv').config();
const { default: makeWASocket, useSingleFileAuthState, downloadContentFromMessage } = require('@adiwajshing/baileys');
const fs = require('fs');
const path = require('path');

const authFile = './auth_info_multi.json';
const { state, saveState } = useSingleFileAuthState(authFile);

async function start() {
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    patchMessageBeforeSending: (message) => {
      // you can patch outbound messages if needed
      return message;
    }
  });

  sock.ev.on('connection.update', (update) => {
    if (update.qr) {
      console.log('=== QR code generated. Scan it in WhatsApp (Linked Devices -> Link a device) ===');
    }
    if (update.connection === 'open') {
      console.log('✅ Connected to WhatsApp!');
    }
  });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (m.type !== 'notify') return;
      const messages = m.messages;
      for (const msg of messages) {
        if (!msg.message) continue;
        // ignore statuses and broadcasts (adjust as needed)
        if (msg.key && msg.key.remoteJid && msg.key.remoteJid.endsWith('@broadcast')) continue;

        // detect message type
        const messageType = Object.keys(msg.message)[0];
        console.log('Received message type:', messageType, 'from:', msg.key.remoteJid);

        // Save text content (if any) — good for logging deleted messages later
        if (msg.message.conversation) {
          const txt = msg.message.conversation;
          const metaLine = `${new Date().toISOString()} | ${msg.key.remoteJid} | text | ${txt}\n`;
          fs.appendFileSync('downloads/messages.log', metaLine, 'utf8');
        }

        // Handle media types
        if (['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(messageType)) {
          // ensure downloads dir exists
          fs.mkdirSync('downloads', { recursive: true });

          // the downloadContentFromMessage helper returns an async iterable of Buffers
          const mediaKind = messageType.replace('Message', '').toLowerCase(); // image, video, audio, document
          const stream = await downloadContentFromMessage(msg.message[messageType], mediaKind);

          // choose extension
          let ext = '.bin';
          if (mediaKind === 'image') ext = '.jpg';
          if (mediaKind === 'video') ext = '.mp4';
          if (mediaKind === 'audio') ext = '.ogg';
          if (mediaKind === 'document' && msg.message[messageType].mimetype) {
            const mime = msg.message[messageType].mimetype;
            // try simple mapping
            if (mime.includes('pdf')) ext = '.pdf';
            else if (mime.includes('zip')) ext = '.zip';
            else if (mime.includes('png')) ext = '.png';
            else if (mime.includes('jpg') || mime.includes('jpeg')) ext = '.jpg';
          }

          const timestamp = Date.now();
          const jidSafe = (msg.key.remoteJid || 'unknown').replace(/[:@]/g, '_');
          const filename = path.join('downloads', `${jidSafe}_${timestamp}${ext}`);
          const writeStream = fs.createWriteStream(filename);

          for await (const chunk of stream) {
            writeStream.write(chunk);
          }
          writeStream.end();

          // save a small metadata file or append log
          const logLine = `${new Date().toISOString()} | ${msg.key.remoteJid} | ${mediaKind} | ${filename}\n`;
          fs.appendFileSync('downloads/media.log', logLine, 'utf8');

          console.log('Saved media to', filename);
        }

        // you can also handle message deletes (if you want to note someone deleted)
        // library emits message.delete or message.update events separately; check docs if needed
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  sock.ev.on('connection.update', (u) => {
    if (u.connection === 'close') {
      console.log('Connection closed — attempting restart');
      start(); // try to reconnect
    }
  });
}

start().catch(err => console.error('start failed', err));
