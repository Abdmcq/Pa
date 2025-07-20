import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import ID3Writer from 'node-id3';
import ffmpeg from 'fluent-ffmpeg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const token = '8016650868:AAGnDW9EaReXm98rcEqccL6HzI7S5M_4-Vc';
const bot = new Telegraf(token);
const userSessions = new Map();

const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🤖 Bot is alive!'));
app.listen(port, () => {
  console.log(`🚀 Web server running on port ${port}`);
});

bot.start((ctx) => {
  userSessions.set(ctx.from.id, {});
  return ctx.reply(
    '🎵 اختر القسم الذي تريده:',
    Markup.keyboard([
      ['🎧 تعديل معلومات أغنية'],
      ['✂️ قص الأغنية'],
      ['🔐 تشفير / فك تشفير نصوص']
    ]).resize()
  );
});

bot.hears('🎧 تعديل معلومات أغنية', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'edit' });
  ctx.reply('📤 أرسل ملف الأغنية بأي صيغة (mp3, wav, ogg, ...)');
});

bot.hears('✂️ قص الأغنية', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'trim' });
  ctx.reply('📤 أرسل ملف الأغنية التي تريد قصها');
});

bot.hears('🔐 تشفير / فك تشفير نصوص', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'crypto' });
  ctx.reply(`🧪 أرسل الأمر المطلوب:

- /encrypt 5 هذا نص
- /decrypt ARv6-...
`, { parse_mode: 'Markdown' });
});

bot.on('audio', async (ctx) => handleAudio(ctx));
bot.on('document', async (ctx) => {
  const mime = ctx.message.document.mime_type || '';
  if (mime.startsWith('audio')) await handleAudio(ctx);
});

async function handleAudio(ctx) {
  const userId = ctx.from.id;
  const session = userSessions.get(userId) || {};
  session.audio = ctx.message.audio || ctx.message.document;
  userSessions.set(userId, session);

  if (session.mode === 'edit') ctx.reply('📛 أرسل اسم الأغنية:');
  else if (session.mode === 'trim') ctx.reply('⏱️ أرسل وقت البداية (بالثواني):');
}

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  if (!session || !session.audio) return;

  if (session.mode === 'edit') {
    if (!session.title) {
      session.title = ctx.message.text;
      ctx.reply('👤 الآن أرسل اسم الفنان:');
    } else if (!session.artist) {
      session.artist = ctx.message.text;
      ctx.reply('🖼️ هل ترغب في تغيير صورة الغلاف؟ أرسلها الآن، أو أرسل /skip لتخطي.');
    }
  } else if (session.mode === 'trim') {
    if (!session.start) {
      session.start = parseFloat(ctx.message.text);
      ctx.reply('🛑 أرسل وقت النهاية (بالثواني):');
    } else if (!session.end) {
      session.end = parseFloat(ctx.message.text);
      await trimAudio(ctx, session);
      userSessions.delete(userId);
    }
  }
  userSessions.set(userId, session);
});

bot.command('skip', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  if (!session || session.mode !== 'edit' || !session.audio || !session.title || !session.artist) {
    return ctx.reply('❗ لا يوجد ملف أو بيانات كافية للتخطي.');
  }

  try {
    const audioFileId = session.audio.file_id;
    const fileLink = await ctx.telegram.getFileLink(audioFileId);
    const audioBuffer = await (await fetch(fileLink.href)).arrayBuffer();
    const tempFile = path.join(__dirname, `${Date.now()}_edited.mp3`);
    fs.writeFileSync(tempFile, Buffer.from(audioBuffer));

    ID3Writer.write({ title: session.title, artist: session.artist }, tempFile);

    await ctx.replyWithAudio({ source: tempFile, title: session.title, performer: session.artist });
    fs.unlinkSync(tempFile);
    userSessions.delete(userId);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ حدث خطأ أثناء تعديل الملف.');
  }
});

bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  if (!session || session.mode !== 'edit' || !session.title || !session.artist) {
    return ctx.reply('❗ أرسل ملف الأغنية وبياناتها أولًا.');
  }

  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const audioFileId = session.audio.file_id;
    const fileLink = await ctx.telegram.getFileLink(audioFileId);
    const photoLink = await ctx.telegram.getFileLink(photo.file_id);

    const audioBuffer = await (await fetch(fileLink.href)).arrayBuffer();
    const imageBuffer = await (await fetch(photoLink.href)).arrayBuffer();
    const tempFile = path.join(__dirname, `${Date.now()}_song.mp3`);
    fs.writeFileSync(tempFile, Buffer.from(audioBuffer));

    const tags = {
      title: session.title,
      artist: session.artist,
      image: {
        mime: 'image/jpeg',
        type: { id: 3, name: 'front cover' },
        description: 'Cover',
        imageBuffer: Buffer.from(imageBuffer)
      }
    };

    ID3Writer.write(tags, tempFile);
    await ctx.replyWithAudio({ source: tempFile, title: session.title, performer: session.artist });
    fs.unlinkSync(tempFile);
    userSessions.delete(userId);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ حدث خطأ أثناء تعديل الملف.');
  }
});

async function trimAudio(ctx, session) {
  try {
    const fileLink = await ctx.telegram.getFileLink(session.audio.file_id);
    const inputPath = path.join(__dirname, `${Date.now()}_input`);
    const outputPath = path.join(__dirname, `${Date.now()}_trimmed.mp3`);

    const audioBuffer = await (await fetch(fileLink.href)).arrayBuffer();
    fs.writeFileSync(inputPath, Buffer.from(audioBuffer));

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(session.start)
        .setDuration(session.end - session.start)
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    await ctx.replyWithAudio({ source: outputPath });
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ فشل في قص المقطع.');
  }
}

function customEncrypt(text, complexity) {
  let currentText = text;
  for (let i = 0; i < complexity; i++) {
    currentText = Array.from(currentText).map((char, index) => {
      const charCode = char.charCodeAt(0);
      const key = (index % 128) ^ (i * 5 + 3);
      return String.fromCharCode(charCode ^ key);
    }).join('');
  }
  return `ARv6-${complexity}-${Buffer.from(currentText, 'utf-8').toString('base64')}`;
}

function customDecrypt(encryptedText) {
  if (!encryptedText.startsWith('ARv6-')) throw new Error("صيغة غير صحيحة");
  const parts = encryptedText.split('-');
  const complexity = parseInt(parts[1], 10);
  const base64String = parts.slice(2).join('-');
  let currentText = Buffer.from(base64String, 'base64').toString('utf-8');
  for (let i = complexity - 1; i >= 0; i--) {
    currentText = Array.from(currentText).map((char, index) => {
      const charCode = char.charCodeAt(0);
      const key = (index % 128) ^ (i * 5 + 3);
      return String.fromCharCode(charCode ^ key);
    }).join('');
  }
  return currentText;
}

bot.hears(/^\/encrypt\s+(.+)/, (ctx) => {
  const parts = ctx.match[1].split(' ');
  if (parts.length < 2) return ctx.reply('❗ مثال: /encrypt 5 نص', { parse_mode: 'Markdown' });

  const complexity = parseInt(parts[0], 10);
  const text = parts.slice(1).join(' ');

  if (isNaN(complexity) || complexity < 1 || complexity > 10)
    return ctx.reply('❗ مستوى التشفير يجب أن يكون من 1 إلى 10');

  try {
    const encrypted = customEncrypt(text, complexity);
    ctx.reply(`✅ النص المشفر:\n\`${encrypted}\``, { parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply(`❌ خطأ: ${e.message}`);
  }
});

bot.hears(/^\/decrypt\s+(.+)/, (ctx) => {
  try {
    const decrypted = customDecrypt(ctx.match[1]);
    ctx.reply(`✅ النص بعد فك التشفير:\n${decrypted}`);
  } catch (e) {
    ctx.reply(`❌ خطأ: ${e.message}`);
  }
});

bot.launch();
console.log('🤖 Bot is running...');
