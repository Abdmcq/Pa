import { Telegraf } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import ID3Writer from 'node-id3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bot = new Telegraf('7892395794:AAHy-_f_ej0IT0ZLF1jzdXJDMccLiCrMrZA');

const userSessions = new Map();

bot.start((ctx) => {
  ctx.reply('🎧 أرسل لي ملف أغنية (mp3) وسأقوم بتعديل معلوماتها. أرسلها مع اسم الأغنية، الفنان، وصورة الغلاف.');
});

bot.on('audio', async (ctx) => {
  const userId = ctx.from.id;
  userSessions.set(userId, { audio: ctx.message.audio });

  ctx.reply('📛 أرسل اسم الأغنية:');
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);

  if (session && session.audio && !session.title) {
    session.title = ctx.message.text;
    ctx.reply('👤 الآن أرسل اسم الفنان:');
  } else if (session && session.audio && session.title && !session.artist) {
    session.artist = ctx.message.text;
    ctx.reply('🖼️ أخيرًا، أرسل صورة الغلاف (jpg/png):');
  } else {
    ctx.reply('❗ أرسل ملف mp3 أولًا.');
  }
});

bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);

  if (!session || !session.audio || !session.title || !session.artist) {
    return ctx.reply('❗ أرسل ملف الأغنية وبياناتها أولًا.');
  }

  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  const fileId = session.audio.file_id;
  const fileLink = await ctx.telegram.getFileLink(fileId);
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
      type: {
        id: 3,
        name: 'front cover'
      },
      description: 'Cover',
      imageBuffer: Buffer.from(imageBuffer)
    }
  };

  ID3Writer.write(tags, tempFile);

  await ctx.replyWithAudio({ source: tempFile });

  fs.unlinkSync(tempFile);
  userSessions.delete(userId);
});

bot.launch();
console.log('🤖 Bot is running...');
