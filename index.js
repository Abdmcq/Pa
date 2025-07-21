// --- استيراد المكتبات المطلوبة ---
import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import NodeID3 from 'node-id3';
import ffmpeg from 'fluent-ffmpeg';
import YtDlpWrap_ from 'yt-dlp-wrap';

// --- الإعدادات الأولية ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const YtDlpWrap = YtDlpWrap_.default || YtDlpWrap_;
const ytDlpWrap = new YtDlpWrap();

// *** تم إرجاع التوكن إلى الكود مباشرة بناءً على طلبك ***
const token = "8016650868:AAGnDW9EaReXm98rcEqccL6HzI7S5M_4-Vc";

if (!token) {
  console.error('خطأ: توكن البوت غير موجود.');
  process.exit(1);
}

const bot = new Telegraf(token);
const userSessions = new Map();

// --- إعداد خادم الويب ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🤖 Bot is alive and running!'));


// --- الدوال المساعدة ---

/**
 * دالة تحميل الفيديو من رابط
 * @param {import('telegraf').Context} ctx
 * @param {string} url
 */
async function handleDownload(ctx, url) {
    const userId = ctx.from.id;
    const processingMessage = await ctx.reply('⏳ جاري تحميل الفيديو، قد يستغرق الأمر بعض الوقت...');
    const outputPath = path.join(__dirname, `${userId}_${Date.now()}_download.mp4`);

    try {
        await ytDlpWrap.execPromise([
            url,
            '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            '-o', outputPath
        ]);

        if (fs.existsSync(outputPath)) {
            await ctx.replyWithVideo({ source: outputPath }, { caption: '✅ تم تحميل الفيديو بنجاح!' });
        } else {
            throw new Error('لم يتم العثور على الملف الناتج بعد التحميل.');
        }

    } catch (err) {
        console.error('Error in handleDownload:', err);
        ctx.reply('❌ حدث خطأ أثناء محاولة تحميل الفيديو. تأكد من أن الرابط صحيح وعام.');
    } finally {
        userSessions.delete(userId);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(() => {});
    }
}

// ... (بقية الدوال والكود كما هي)


/**
 * يعالج ملفات الصوت المستلمة
 * @param {import('telegraf').Context} ctx
 */
async function handleAudio(ctx) {
  const userId = ctx.from.id;
  const session = userSessions.get(userId) || {};
  const audio = ctx.message.audio || ctx.message.document;

  if (session.mode === 'edit') {
    session.audio = audio;
    userSessions.set(userId, session);
    ctx.reply('📛 حسنًا، الآن أرسل اسم الأغنية الجديد:');
  } else if (session.mode === 'trim') {
    session.audio = audio;
    userSessions.set(userId, session);
    ctx.reply('⏱️ أرسل وقت البداية للقص (بالثواني):');
  } else if (session.mode === 'merge') {
    if (!session.audioFiles) {
      session.audioFiles = [];
    }
    session.audioFiles.push(audio);
    userSessions.set(userId, session);
    ctx.reply(`✅ تمت إضافة المقطع رقم ${session.audioFiles.length}. أرسل التالي أو اضغط /done للدمج.`);
  }
}

/**
 * يقوم بقص مقطع الصوت
 * @param {import('telegraf').Context} ctx
 * @param {object} session
 */
async function trimAudio(ctx, session) {
  const userId = ctx.from.id;
  await ctx.reply('⏳ جاري قص المقطع الصوتي...');
  
  const inputPath = path.join(__dirname, `${userId}_${Date.now()}_input.tmp`);
  const outputPath = path.join(__dirname, `${userId}_${Date.now()}_trimmed.mp3`);

  try {
    const fileLink = await ctx.telegram.getFileLink(session.audio.file_id);
    const response = await fetch(fileLink.href);
    const audioBuffer = await response.arrayBuffer();
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

    await ctx.replyWithAudio({ source: outputPath }, { caption: '✅ تم قص المقطع بنجاح!' });

  } catch (err) {
    console.error('Error in trimAudio:', err);
    ctx.reply('❌ حدث خطأ أثناء قص المقطع.');
  } finally {
    userSessions.delete(userId);
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}

/**
 * يقوم بدمج عدة مقاطع صوتية
 * @param {import('telegraf').Context} ctx
 * @param {object} session
 */
async function mergeAudio(ctx, session) {
    const userId = ctx.from.id;
    await ctx.reply(`⏳ جاري دمج ${session.audioFiles.length} مقاطع...`);

    const tempDir = path.join(__dirname, `temp_${userId}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    const fileListPath = path.join(tempDir, 'filelist.txt');
    const outputPath = path.join(__dirname, `${userId}_${Date.now()}_merged.mp3`);

    try {
        for (let i = 0; i < session.audioFiles.length; i++) {
            const file = session.audioFiles[i];
            const fileLink = await ctx.telegram.getFileLink(file.file_id);
            const response = await fetch(fileLink.href);
            const audioBuffer = await response.arrayBuffer();
            const originalFileName = file.file_name || 'audio.tmp';
            const extension = path.extname(originalFileName);
            const tempFilePath = path.join(tempDir, `audio_${i}${extension}`);
            fs.writeFileSync(tempFilePath, Buffer.from(audioBuffer));
            fs.appendFileSync(fileListPath, `file '${path.resolve(tempFilePath)}'\n`);
        }
        
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(fileListPath)
                .inputOptions(['-f', 'concat', '-safe', '0'])
                .audioBitrate('192k')
                .output(outputPath)
                .on('end', resolve)
                .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
                .run();
        });

        await ctx.replyWithAudio({ source: outputPath }, { caption: '✅ تم دمج المقاطع بنجاح!' });

    } catch (err) {
        console.error('Error in mergeAudio:', err);
        ctx.reply('❌ حدث خطأ أثناء دمج المقاطع.');
    } finally {
        userSessions.delete(userId);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

/**
 * دالة تحويل الفيديو إلى صوت
 * @param {import('telegraf').Context} ctx
 * @param {object} video
 */
async function handleConversion(ctx, video) {
    const userId = ctx.from.id;
    await ctx.reply('⏳ جاري تحويل الفيديو إلى صوت...');
    
    const inputPath = path.join(__dirname, `${userId}_${Date.now()}_input_video.tmp`);
    const outputPath = path.join(__dirname, `${userId}_${Date.now()}_converted.mp3`);

    try {
        const fileLink = await ctx.telegram.getFileLink(video.file_id);
        const response = await fetch(fileLink.href);
        const videoBuffer = await response.arrayBuffer();
        fs.writeFileSync(inputPath, Buffer.from(videoBuffer));

        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .noVideo()
                .audioCodec('libmp3lame')
                .audioBitrate('192')
                .save(outputPath)
                .on('end', resolve)
                .on('error', reject);
        });

        await ctx.replyWithAudio({ source: outputPath }, { caption: '✅ تم تحويل الفيديو إلى صوت بنجاح!' });

    } catch (err) {
        console.error('Error in handleConversion:', err);
        ctx.reply('❌ حدث خطأ أثناء تحويل الفيديو.');
    } finally {
        userSessions.delete(userId);
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
}


/**
 * خوارزمية تشفير مخصصة
 * @param {string} text
 * @param {number} complexity
 * @returns {string}
 */
function customEncrypt(text, complexity) {
    let currentText = text;
    for (let i = 0; i < complexity; i++) {
        currentText = Array.from(currentText).map((char, index) => {
            const charCode = char.charCodeAt(0);
            const key = (index % 128) ^ (i * 5 + 3);
            return String.fromCharCode(charCode ^ key);
        }).join('');
    }
    const base64String = Buffer.from(currentText, 'utf-8').toString('base64');
    return `ARv6-${complexity}-${base64String}`;
}

/**
 * خوارزمية فك تشفير مخصصة
 * @param {string} encryptedText
 * @returns {string}
 */
function customDecrypt(encryptedText) {
    if (!encryptedText.startsWith('ARv6-')) {
        throw new Error("صيغة النص المشفر غير صحيحة.");
    }
    const parts = encryptedText.split('-');
    if (parts.length < 3) {
        throw new Error("صيغة النص المشفر غير مكتملة.");
    }
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


// --- منطق البوت ومعالجات الأوامر ---

bot.start((ctx) => {
  userSessions.delete(ctx.from.id);
  return ctx.reply(
    '🎵 أهلاً بك! اختر القسم الذي تريده:',
    Markup.keyboard([
      ['🎧 تعديل أغنية', '✂️ قص أغنية'],
      ['🎶 دمج مقاطع', '🔐 تشفير / فك'],
      ['📥 تحميل', '🔄 حولني']
    ]).resize()
  );
});

bot.command('cancel', (ctx) => {
    userSessions.delete(ctx.from.id);
    ctx.reply('👍 تم إلغاء العملية الحالية.');
});

bot.hears('🎧 تعديل أغنية', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'edit' });
  ctx.reply('📤 أرسل ملف الأغنية للتعديل.');
});

bot.hears('✂️ قص أغنية', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'trim' });
  ctx.reply('📤 أرسل ملف الأغنية للقص.');
});

bot.hears('🎶 دمج مقاطع', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'merge', audioFiles: [] });
    ctx.reply('📤 أرسل المقطع الصوتي الأول.');
});

bot.hears('🔐 تشفير / فك', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'crypto' });
  ctx.reply('🧪 أرسل الأمر بالتنسيق الصحيح:\n\n`/encrypt 5 نص`\n`/decrypt ARv6-...`', { parse_mode: 'Markdown' });
});

bot.hears('📥 تحميل', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'download' });
    ctx.reply('🔗 أرسل رابط الفيديو (يوتيوب، تيك توك، الخ) لتحميله كملف فيديو.');
});

bot.hears('🔄 حولني', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'convert' });
    ctx.reply('📹 أرسل ملف الفيديو لتحويله إلى صوت.');
});

bot.command('done', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (!session || session.mode !== 'merge' || !session.audioFiles || session.audioFiles.length < 2) {
        return ctx.reply('❗ يجب إرسال مقطعين على الأقل.');
    }
    await mergeAudio(ctx, session);
});

bot.hears(/^\/encrypt\s+(\d+)\s+(.+)/s, (ctx) => {
    const complexity = parseInt(ctx.match[1], 10);
    const text = ctx.match[2];
    if (isNaN(complexity) || complexity < 1 || complexity > 10) {
        return ctx.reply('❗ مستوى التعقيد يجب أن يكون بين 1 و 10.');
    }
    try {
        const encrypted = customEncrypt(text, complexity);
        ctx.reply(`✅ تم التشفير:\n\n\`${encrypted}\``, { parse_mode: 'Markdown' });
    } catch (e) {
        ctx.reply(`❌ خطأ: ${e.message}`);
    }
});

bot.hears(/^\/decrypt\s+(ARv6-.+)/s, (ctx) => {
    try {
        const decrypted = customDecrypt(ctx.match[1]);
        ctx.reply(`✅ تم فك التشفير:\n\n${decrypted}`);
    } catch (e) {
        ctx.reply(`❌ خطأ: ${e.message}`);
    }
});

bot.command('skip', async (ctx) => {
  const session = userSessions.get(ctx.from.id);
  if (!session || session.mode !== 'edit' || !session.audio || !session.title || !session.artist) {
    return ctx.reply('❗ لا يمكنك استخدام هذا الأمر الآن.');
  }
  await ctx.reply('⏳ جاري تعديل البيانات...');
  const tempFile = path.join(__dirname, `${ctx.from.id}_edited.mp3`);
  try {
    const fileLink = await ctx.telegram.getFileLink(session.audio.file_id);
    const response = await fetch(fileLink.href);
    const audioBuffer = await response.arrayBuffer();
    fs.writeFileSync(tempFile, Buffer.from(audioBuffer));
    NodeID3.write({ title: session.title, artist: session.artist }, tempFile);
    await ctx.replyWithAudio({ source: tempFile }, { caption: '✅ تم تعديل معلومات الأغنية!' });
  } catch (err) {
    console.error('Error in /skip:', err);
    ctx.reply('❌ حدث خطأ أثناء تعديل الملف.');
  } finally {
    userSessions.delete(ctx.from.id);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

// معالجات الوسائط
bot.on('audio', (ctx) => handleAudio(ctx));

bot.on('video', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (session && session.mode === 'convert') {
        await handleConversion(ctx, ctx.message.video);
    }
});

bot.on('document', (ctx) => {
  const mime = ctx.message.document.mime_type || '';
  if (mime.startsWith('audio')) {
    handleAudio(ctx);
  } else if (mime.startsWith('video')) {
    const session = userSessions.get(ctx.from.id);
    if (session && session.mode === 'convert') {
        handleConversion(ctx, ctx.message.document);
    }
  }
});

bot.on('photo', async (ctx) => {
  const session = userSessions.get(ctx.from.id);
  if (!session || session.mode !== 'edit' || !session.audio || !session.title || !session.artist) {
    return ctx.reply('❗ لا يمكنك إرسال صورة الآن.');
  }
  await ctx.reply('🖼️ تم استلام الصورة، جاري دمجها...');
  const tempFile = path.join(__dirname, `${ctx.from.id}_final.mp3`);
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const photoLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageResponse = await fetch(photoLink.href);
    const imageBuffer = await imageResponse.arrayBuffer();
    const audioLink = await ctx.telegram.getFileLink(session.audio.file_id);
    const audioResponse = await fetch(audioLink.href);
    const audioBuffer = await audioResponse.arrayBuffer();
    fs.writeFileSync(tempFile, Buffer.from(audioBuffer));
    NodeID3.write({ title: session.title, artist: session.artist, image: { mime: 'image/jpeg', type: { id: 3, name: 'front cover' }, description: 'Cover', imageBuffer: Buffer.from(imageBuffer) } }, tempFile);
    await ctx.replyWithAudio({ source: tempFile }, { caption: '✅ تم تعديل الأغنية والصورة بنجاح!' });
  } catch (err) {
    console.error('Error in photo handler:', err);
    ctx.reply('❌ حدث خطأ أثناء دمج الصورة.');
  } finally {
    userSessions.delete(ctx.from.id);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

// المعالج العام للرسائل النصية
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  const text = ctx.message.text;

  if (text.startsWith('/')) return;
  if (!session || !session.mode) return;
  
  if (session.mode === 'download') {
      try {
          new URL(text);
          await handleDownload(ctx, text);
      } catch (_) {
          ctx.reply('❌ الرابط الذي أرسلته غير صالح.');
      }
      return;
  }

  if (session.mode === 'edit') {
    if (!session.audio) return;
    if (!session.title) {
      session.title = text;
      ctx.reply('👤 رائع، الآن أرسل اسم الفنان:');
    } else if (!session.artist) {
      session.artist = text;
      ctx.reply('🖼️ ممتاز! الآن أرسل صورة جديدة، أو /skip للتخطي.');
    }
  } else if (session.mode === 'trim') {
    if (!session.audio) return;
    if (!session.hasOwnProperty('start')) {
      const startTime = parseFloat(text);
      if (isNaN(startTime) || startTime < 0) {
        return ctx.reply('❌ وقت بداية غير صالح.');
      }
      session.start = startTime;
      ctx.reply('🛑 الآن أرسل وقت النهاية (بالثواني):');
    } else if (!session.hasOwnProperty('end')) {
      const endTime = parseFloat(text);
      if (isNaN(endTime) || endTime <= session.start) {
        return ctx.reply('❌ وقت نهاية غير صالح.');
      }
      session.end = endTime;
      await trimAudio(ctx, session);
    }
  }
  if (userSessions.has(userId)) userSessions.set(userId, session);
});


// --- دالة تهيئة وتشغيل البوت ---
async function initializeAndLaunch() {
    try {
        const ytDlpPath = path.join(__dirname, 'yt-dlp');
        
        if (!fs.existsSync(ytDlpPath)) {
            console.log('Downloading yt-dlp binary, this may take a moment...');
            await YtDlpWrap.downloadFromGithub(ytDlpPath);
            console.log('yt-dlp binary downloaded successfully.');
        } else {
            console.log('yt-dlp binary already exists.');
        }
        
        ytDlpWrap.setBinaryPath(ytDlpPath);

        app.listen(port, () => {
          console.log(`🚀 Web server has started on port ${port}`);
        });

        bot.launch();
        console.log('🤖 Bot has been launched and is running...');

    } catch (error) {
        console.error('❌ Failed to initialize the bot:', error);
        process.exit(1);
    }
}

// بدء كل شيء
initializeAndLaunch();


// معالجة إيقاف البوت بأمان
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

