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

const bot = new Telegraf('7892395794:AAHy-_f_ej0IT0ZLF1jzdXJDMccLiCrMrZA');
const userSessions = new Map();

bot.start((ctx) => {
  userSessions.set(ctx.from.id, {});

  return ctx.reply(
    '🎵 اختر القسم الذي تريده:',
    Markup.keyboard([
      ['🎧 تعديل معلومات أغنية'],
      ['✂️ قص الأغنية']
    ]).resize()
  );
});

// Handle main menu selection
bot.hears('🎧 تعديل معلومات أغنية', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'edit' });
  ctx.reply('📤 أرسل ملف الأغنية بأي صيغة (mp3, wav, ogg, ...)');
});

bot.hears('✂️ قص الأغنية', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'trim' });
  ctx.reply('📤 أرسل ملف الأغنية التي تريد قصها');
});

bot.on('audio', async (ctx) => handleAudio(ctx));
bot.on('document', async (ctx) => {
  const mime = ctx.message.document.mime_type || '';
  if (mime.startsWith('audio')) {
    await handleAudio(ctx);
  }
});

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

bot.launch();
console.log('🤖 Bot is running...');


// قسم: تغيير اسم المستندات
bot.hears('📝 تغيير اسم المستند', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'rename' });
  ctx.reply('📎 أرسل المستند (PDF, DOCX, PPTX, ...):');
});

// قسم: تحويل صيغة الملفات
bot.hears('🔄 تحويل صيغة الملفات', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'convert' });
  ctx.reply('📎 أرسل الملف الذي تريد تحويله (PDF, DOCX, PPTX، ...):');
});

// استقبال الملفات العامة للمستندات
bot.on('document', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId) || {};
  const document = ctx.message.document;

  if (!['rename', 'convert'].includes(session.mode)) return;

  session.file = document;
  userSessions.set(userId, session);

  if (session.mode === 'rename') {
    ctx.reply('✏️ أرسل الاسم الجديد للملف (بدون لاحقة):');
  } else 

  

  userSessions.set(userId, session);
});

// تحديث قائمة البداية لتشمل الخيارات الأربعة
bot.start((ctx) => {
  userSessions.set(ctx.from.id, {});
  return ctx.reply(
    '🎵 اختر القسم الذي تريده:',
    Markup.keyboard([
      ['🎧 تعديل معلومات أغنية', '✂️ قص الأغنية'],
      ['📝 تغيير اسم المستند', '🔄 تحويل صيغة الملفات']
    ]).resize()
  );
});
