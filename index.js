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

const bot = new Telegraf('ضع التوكن الخاص بك هنا');
const userSessions = new Map();

// بدء البوت
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

// أوامر القائمة الرئيسية
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
  ctx.reply(`🧪 أرسل الأمر المطلوب بالشكل التالي:

- لتشفير نص:
\`/encrypt 5 هذا نص للتشفير\`

- لفك التشفير:
\`/decrypt ARv6-5-......\`

🔢 مستوى التشفير من 1 إلى 10.
`, { parse_mode: 'Markdown' });
});

// استقبال الملفات الصوتية
bot.on('audio', async (ctx) => handleAudio(ctx));
bot.on('document', async (ctx) => {
  const mime = ctx.message.document.mime_type || '';
  if (mime.startsWith('audio')) {
    await handleAudio(ctx);
  }
});

// التعامل مع استقبال الصوت
async function handleAudio(ctx) {
  const userId = ctx.from.id;
  const session = userSessions.get(userId) || {};

  session.audio = ctx.message.audio || ctx.message.document;
  userSessions.set(userId, session);

  if (session.mode === 'edit') {
    ctx.reply('📛 أرسل اسم الأغنية:');
  } else if (session.mode === 'trim') {
    ctx.reply('⏱️ أرسل وقت البداية (بالثواني، مثل 30):');
  }
}

// استقبال النصوص حسب الحالة
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
      ctx.reply('🛑 أرسل وقت النهاية (بالثواني، مثل 60):');
    } else if (!session.end) {
      session.end = parseFloat(ctx.message.text);
      await trimAudio(ctx, session);
      userSessions.delete(userId);
    }
  }

  userSessions.set(userId, session);
});

// تخطي صورة الغلاف
bot.command('skip', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  if (!session || session.mode !== 'edit' || !session.audio || !session.title || !session.artist) {
    return ctx.reply('❗ لا يوجد ملف قيد المعالجة.');
  }

  try {
    const audioFileId = session.audio.file_id;
    const fileLink = await ctx.telegram.getFileLink(audioFileId);
    const audioBuffer = await (await fetch(fileLink.href)).arrayBuffer();

    const tempFile = path.join(__dirname, `${Date.now()}_song.mp3`);
    fs.writeFileSync(tempFile, Buffer.from(audioBuffer));

    const tags = {
      title: session.title,
      artist: session.artist
    };

    ID3Writer.write(tags, tempFile);

    await ctx.replyWithAudio({
      source: tempFile,
      title: session.title,
      performer: session.artist
    });

    fs.unlinkSync(tempFile);
    userSessions.delete(userId);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ حدث خطأ أثناء تعديل الملف.');
  }
});

// استقبال صورة الغلاف
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

    await ctx.replyWithAudio({
      source: tempFile,
      title: session.title,
      performer: session.artist,
      thumb: { url: photoLink.href }
    });

    fs.unlinkSync(tempFile);
    userSessions.delete(userId);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ حدث خطأ أثناء تعديل الملف.');
  }
});

// قص الأغنية
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

// ====== التشفير وفك التشفير ======

function customEncrypt(text, complexity) {
  let currentText = text;
  for (let i = 0; i < complexity; i++) {
    currentText = Array.from(currentText).map((char, index) => {
      const charCode = char.charCodeAt(0);
      const key = (index % 128) ^ (i * 5 + 3);
      return String.fromCharCode(charCode ^ key);
    }).join('');
  }
  try {
    const base64String = Buffer.from(currentText, 'utf-8').toString('base64');
    return `ARv6-${complexity}-${base64String}`;
  } catch (e) {
    throw new Error("صار خطأ بالتشفير.");
  }
}

function customDecrypt(encryptedText) {
  if (!encryptedText.startsWith('ARv6-')) {
    throw new Error("صيغة النص المشفر بيها غلط.");
  }
  const parts = encryptedText.split('-');
  const complexity = parseInt(parts[1], 10);
  const base64String = parts.slice(2).join('-');
  if (isNaN(complexity)) {
    throw new Error("مستوى التشفير غير صالح.");
  }
  let currentText;
  try {
    currentText = Buffer.from(base64String, 'base64').toString('utf-8');
  } catch (e) {
    throw new Error("النص المشفر تالف.");
  }
  for (let i = complexity - 1; i >= 0; i--) {
    currentText = Array.from(currentText).map((char, index) => {
      const charCode = char.charCodeAt(0);
      const key = (index % 128) ^ (i * 5 + 3);
      return String.fromCharCode(charCode ^ key);
    }).join('');
  }
  return currentText;
}

// أوامر التشفير
bot.hears(/^\/encrypt\s+(.+)/, (ctx) => {
  const parts = ctx.match[1].split(' ');
  if (parts.length < 2) {
    return ctx.reply('❗ الصيغة غير صحيحة. مثال: `/encrypt 5 هذا نص`', { parse_mode: 'Markdown' });
  }

  const complexity = parseInt(parts[0], 10);
  const text = parts.slice(1).join(' ');

  if (isNaN(complexity) || complexity < 1 || complexity > 10) {
    return ctx.reply('❗ مستوى التشفير لازم يكون بين 1 و 10.');
  }

  try {
    const encrypted = customEncrypt(text, complexity);
    ctx.reply(`✅ النص المشفر:\n\`${encrypted}\``, { parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply(`❌ خطأ أثناء التشفير: ${e.message}`);
  }
});

bot.hears(/^\/decrypt\s+(.+)/, (ctx) => {
  const encryptedText = ctx.match[1];

  try {
    const decrypted = customDecrypt(encryptedText);
    ctx.reply(`✅ النص بعد فك التشفير:\n${decrypted}`);
  } catch (e) {
    ctx.reply(`❌ خطأ أثناء فك التشفير: ${e.message}`);
  }
});

// تشغيل البوت
bot.launch();
console.log('🤖 Bot is running...');
