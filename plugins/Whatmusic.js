// plugins/whatmusic.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const FormData = require('form-data');
const { promisify } = require('util');
const { pipeline } = require('stream');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const yts = require('yt-search');

const streamPipeline = promisify(pipeline);

// —— Config ——
const CDN_UPLOAD = 'https://cdn.russellxz.click/upload.php';
const NEOXR_KEY  = 'russellxz';

// —— Helpers ——
// Desanidar mensajes (ephemeral / viewOnce / etc.)
function unwrapMessage(m) {
  let n = m;
  while (
    n?.viewOnceMessage?.message ||
    n?.viewOnceMessageV2?.message ||
    n?.viewOnceMessageV2Extension?.message ||
    n?.ephemeralMessage?.message
  ) {
    n =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message;
  }
  return n;
}

function getQuoted(msg) {
  const root = unwrapMessage(msg?.message) || {};
  const ci =
    root?.extendedTextMessage?.contextInfo ||
    root?.imageMessage?.contextInfo ||
    root?.videoMessage?.contextInfo ||
    root?.audioMessage?.contextInfo ||
    root?.documentMessage?.contextInfo ||
    root?.stickerMessage?.contextInfo ||
    null;
  return ci?.quotedMessage ? unwrapMessage(ci.quotedMessage) : null;
}

function extFromMime(m) {
  if (!m) return null;
  m = String(m).toLowerCase();
  const map = {
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
  };
  return map[m] || null;
}

async function downloadToFile(DL, node, type, outPath) {
  const stream = await DL(node, type);
  const ws = fs.createWriteStream(outPath);
  for await (const chunk of stream) ws.write(chunk);
  ws.end();
  await new Promise(r => ws.on('finish', r));
}

function safeUnlink(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

function slug(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80) || `song_${Date.now()}`;
}

const handler = async (msg, { conn, wa }) => {
  // 👇 usar wa.downloadContentFromMessage si existe; si no, fallback a Baileys
  const DL = (wa && typeof wa.downloadContentFromMessage === 'function')
    ? wa.downloadContentFromMessage
    : downloadContentFromMessage;

  const chatId = msg.key.remoteJid;
  const rawID = conn.user?.id || '';
  const subbotID = rawID.split(':')[0] + '@s.whatsapp.net';

  // Prefijo por sub-bot (si existe)
  const prefixPath = path.resolve('prefixes.json');
  let usedPrefix = '.';
  if (fs.existsSync(prefixPath)) {
    try {
      const pf = JSON.parse(fs.readFileSync(prefixPath, 'utf-8'));
      usedPrefix = pf[subbotID] || '.';
    } catch {}
  }

  const q = getQuoted(msg);
  const qAudio = q?.audioMessage || null;
  const qVideo = q?.videoMessage || null;

  if (!qAudio && !qVideo) {
    await conn.sendMessage(chatId, {
      text: `✳️ Responde a una *nota de voz*, *audio* o *video* para identificar la canción.\n\nEjemplo: *${usedPrefix}whatmusic*`
    }, { quoted: msg });
    return;
  }

  try { await conn.sendMessage(chatId, { react: { text: '🔍', key: msg.key } }); } catch {}

  const tmpDir = path.join(__dirname, '../tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  let inputPath, rawExt, mime, type;
  try {
    type = qAudio ? 'audio' : 'video';
    mime = (qAudio || qVideo).mimetype || (qAudio ? 'audio/mpeg' : 'video/mp4');
    rawExt = extFromMime(mime) || (qAudio ? 'mp3' : 'mp4');
    inputPath = path.join(tmpDir, `${Date.now()}_in.${rawExt}`);

    // Descargar media citado (con DL que usa wa si existe)
    await downloadToFile(DL, qAudio || qVideo, type, inputPath);

    // Subir al CDN para obtener URL
    const form = new FormData();
    form.append('file', fs.createReadStream(inputPath));
    form.append('expiry', '3600');
    const up = await axios.post(CDN_UPLOAD, form, { headers: form.getHeaders(), timeout: 120000 });

    if (!up.data?.url) throw new Error('No se pudo subir el archivo al CDN.');
    const fileUrl = up.data.url;

    // Identificar la canción con neoxr
    const apiURL = `https://api.neoxr.eu/api/whatmusic?url=${encodeURIComponent(fileUrl)}&apikey=${NEOXR_KEY}`;
    const res = await axios.get(apiURL, { timeout: 120000 });

    if (!res.data?.status || !res.data?.data) throw new Error('No se pudo identificar la canción.');
    const { title, artist, album, release } = res.data.data;

    // Buscar en YouTube
    const yt = await yts(`${title} ${artist}`);
    const video = yt?.videos?.[0];
    if (!video) throw new Error('No se encontró la canción en YouTube.');

    const banner =
`╔══════════════════╗
║ ✦ 𝗟𝗮 𝗦𝘂𝗸𝗶 𝗕𝗼𝘁 ✦
╚══════════════════╝

🎵 *Canción detectada*
╭─────────────────╮
├ 📌 *Título:* ${title}
├ 👤 *Artista:* ${artist}
├ 💿 *Álbum:* ${album || '-'}
├ 📅 *Lanzamiento:* ${release || '-'}
├ 🔎 *Coincidencia:* ${video.title}
├ ⏱️ *Duración:* ${video.timestamp}
├ 👁️ *Vistas:* ${Number(video.views || 0).toLocaleString()}
├ 📺 *Canal:* ${video.author?.name || '-'}
├ 🔗 *Link:* ${video.url}
╰─────────────────╯

⏳ Descargando el audio en 128 kbps…`;

    await conn.sendMessage(chatId, {
      image: { url: video.thumbnail },
      caption: banner
    }, { quoted: msg });

    // Descargar audio de YouTube vía neoxr
    const yta = await axios.get(
      `https://api.neoxr.eu/api/youtube?url=${encodeURIComponent(video.url)}&type=audio&quality=128kbps&apikey=${NEOXR_KEY}`,
      { timeout: 180000 }
    );

    const audioURL = yta?.data?.data?.url;
    if (!audioURL) throw new Error('No pude obtener el audio desde YouTube.');

    const rawPath   = path.join(tmpDir, `${Date.now()}_raw.m4a`);
    const finalPath = path.join(tmpDir, `${slug(title)}.mp3`);

    const audioStream = await axios.get(audioURL, { responseType: 'stream', timeout: 300000 });
    await streamPipeline(audioStream.data, fs.createWriteStream(rawPath));

    // Convertir a MP3 (libmp3lame, 128k)
    await new Promise((resolve, reject) => {
      ffmpeg(rawPath)
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .format('mp3')
        .save(finalPath)
        .on('end', resolve)
        .on('error', reject);
    });

    await conn.sendMessage(chatId, {
      audio: fs.readFileSync(finalPath),
      mimetype: 'audio/mpeg',
      fileName: path.basename(finalPath),
      ptt: false
    }, { quoted: msg });

    safeUnlink(inputPath);
    safeUnlink(rawPath);
    safeUnlink(finalPath);

    try { await conn.sendMessage(chatId, { react: { text: '✅', key: msg.key } }); } catch {}

  } catch (err) {
    console.error('[whatmusic] Error:', err?.message || err);
    try {
      await conn.sendMessage(chatId, { text: `❌ *Error:* ${err?.message || 'Fallo desconocido.'}` }, { quoted: msg });
      await conn.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
    } catch {}
  } finally {
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) {
        if (/_in\.|_raw\.|\.mp3$|\.m4a$/i.test(f)) {
          safeUnlink(path.join(tmpDir, f));
        }
      }
    } catch {}
  }
};

handler.command = ['whatmusic'];
handler.help = ['whatmusic'];
handler.tags = ['audio', 'tools'];
handler.register = true;

module.exports = handler;
