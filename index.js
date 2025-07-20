// --- استيراد المكتبات المطلوبة ---
import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import NodeID3 from 'node-id3';
import ffmpeg from 'fluent-ffmpeg';

// --- الإعدادات الأولية ---

// الحصول على مسار المجلد الحالي (مهم لوحدات ES)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// تم تضمين التوكن مباشرة في الكود بناءً على طلبك
const token = "8016650868:AAGnDW9EaReXm98rcEqccL6HzI7S5M_4-Vc";

if (!token) {
  console.error('خطأ: توكن البوت غير موجود.');
  process.exit(1); // إيقاف التشغيل إذا لم يتم العثور على التوكن
}

const bot = new Telegraf(token);
const userSessions = new Map(); // لتخزين حالة كل مستخدم مؤقتًا

// --- إعداد خادم الويب (للتشغيل على Render) ---

const app = express();
const port = process.env.PORT || 3000;
// هذا الجزء يبقي البوت نشطًا على منصات مثل Render
app.get('/', (req, res) => res.send('🤖 Bot is alive and running!'));
app.listen(port, () => {
  console.log(`🚀 Web server has started on port ${port}`);
});


// --- الدوال المساعدة ---

/**
 * يعالج ملفات الصوت المستلمة من المستخدم
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
    ctx.reply('⏱️ أرسل وقت البداية الذي تريد القص منه (بالثواني):');
  } else if (session.mode === 'merge') {
    if (!session.audioFiles) {
      session.audioFiles = [];
    }
    session.audioFiles.push(audio);
    userSessions.set(userId, session);
    ctx.reply(`✅ تمت إضافة المقطع رقم ${session.audioFiles.length}. أرسل المقطع التالي أو اضغط /done للبدء في عملية الدمج.`);
  }
}

/**
 * يقوم بقص مقطع الصوت باستخدام ffmpeg
 * @param {import('telegraf').Context} ctx
 * @param {object} session
 */
async function trimAudio(ctx, session) {
  const userId = ctx.from.id;
  await ctx.reply('⏳ جاري قص المقطع الصوتي، يرجى الانتظار...');
  
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
    ctx.reply('❌ حدث خطأ فادح أثناء محاولة قص المقطع. يرجى المحاولة مرة أخرى.');
  } finally {
    // تنظيف الجلسة والملفات المؤقتة في كل الحالات
    userSessions.delete(userId);
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}

/**
 * يقوم بدمج عدة مقاطع صوتية في مقطع واحد
 * @param {import('telegraf').Context} ctx
 * @param {object} session
 */
async function mergeAudio(ctx, session) {
    const userId = ctx.from.id;
    await ctx.reply(`⏳ جاري دمج ${session.audioFiles.length} مقاطع، يرجى الانتظار...`);

    const tempDir = path.join(__dirname, `temp_${userId}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    const fileListPath = path.join(tempDir, 'filelist.txt');
    const outputPath = path.join(__dirname, `${userId}_${Date.now()}_merged.mp3`);
    const downloadedFiles = [];

    try {
        // تحميل كل الملفات وكتابة قائمة الملفات لـ ffmpeg
        for (let i = 0; i < session.audioFiles.length; i++) {
            const file = session.audioFiles[i];
            const fileLink = await ctx.telegram.getFileLink(file.file_id);
            const response = await fetch(fileLink.href);
            const audioBuffer = await response.arrayBuffer();
            
            const tempFilePath = path.join(tempDir, `audio_${i}.mp3`);
            fs.writeFileSync(tempFilePath, Buffer.from(audioBuffer));
            downloadedFiles.push(tempFilePath);
            // الصيغة المطلوبة لملف القائمة في ffmpeg
            fs.appendFileSync(fileListPath, `file '${path.resolve(tempFilePath)}'\n`);
        }
        
        // تنفيذ أمر الدمج باستخدام ffmpeg
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(fileListPath)
                .inputOptions(['-f', 'concat', '-safe', '0'])
                .outputOptions('-c', 'copy')
                .output(outputPath)
                .on('end', resolve)
                .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
                .run();
        });

        await ctx.replyWithAudio({ source: outputPath }, { caption: '✅ تم دمج المقاطع بنجاح!' });

    } catch (err) {
        console.error('Error in mergeAudio:', err);
        ctx.reply('❌ حدث خطأ فادح أثناء محاولة دمج المقاطع. يرجى التأكد من أن جميع الملفات بنفس الصيغة والمواصفات.');
    } finally {
        // تنظيف شامل للجلسة وكل الملفات المؤقتة
        userSessions.delete(userId);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
}


/**
 * خوارزمية تشفير مخصصة
 * @param {string} text النص المراد تشفيره
 * @param {number} complexity مستوى التعقيد
 * @returns {string} النص المشفر
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
 * @param {string} encryptedText النص المشفر
 * @returns {string} النص الأصلي
 */
function customDecrypt(encryptedText) {
    if (!encryptedText.startsWith('ARv6-')) {
        throw new Error("صيغة النص المشفر غير صحيحة. يجب أن يبدأ بـ 'ARv6-'.");
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


// --- منطق البوت ومعالجات الأوامر (مرتبة حسب الأولوية) ---

// 1. أمر البدء والإلغاء
bot.start((ctx) => {
  userSessions.delete(ctx.from.id); // إعادة تعيين أي جلسة سابقة
  return ctx.reply(
    '🎵 أهلاً بك! اختر القسم الذي تريده من القائمة بالأسفل:',
    Markup.keyboard([
      ['🎧 تعديل معلومات أغنية', '✂️ قص أغنية'],
      ['🎶 دمج مقاطع صوتية', '🔐 تشفير / فك تشفير']
    ]).resize()
  );
});

bot.command('cancel', (ctx) => {
    userSessions.delete(ctx.from.id);
    ctx.reply('👍 تم إلغاء العملية الحالية. يمكنك البدء من جديد باختيار أحد الخيارات.');
});


// 2. معالجات القائمة الرئيسية
bot.hears('🎧 تعديل معلومات أغنية', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'edit' });
  ctx.reply('📤 ممتاز! الآن أرسل ملف الأغنية الذي تريد تعديله. لإلغاء العملية أرسل /cancel');
});

bot.hears('✂️ قص أغنية', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'trim' });
  ctx.reply('📤 حسنًا، أرسل ملف الأغنية التي تريد قصها. لإلغاء العملية أرسل /cancel');
});

bot.hears('🎶 دمج مقاطع صوتية', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'merge', audioFiles: [] });
    ctx.reply('📤 ممتاز! أرسل المقطع الصوتي الأول.\nعندما تنتهي من إرسال كل المقاطع، اضغط /done للدمج.\nلإلغاء العملية أرسل /cancel');
});

bot.hears('🔐 تشفير / فك تشفير', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'crypto' });
  ctx.reply(`🧪 أرسل الأمر بالتنسيق الصحيح:

لتشفير نص (مستوى التعقيد من 1 إلى 10):
\`/encrypt 5 هذا نص تجريبي\`

لفك تشفير نص:
\`/decrypt ARv6-...\`
`, { parse_mode: 'Markdown' });
});

// 3. معالجات الأوامر المحددة
bot.command('done', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions.get(userId);

    if (!session || session.mode !== 'merge') {
        return ctx.reply('❗ لا يمكنك استخدام هذا الأمر الآن.');
    }
    if (!session.audioFiles || session.audioFiles.length < 2) {
        return ctx.reply('❗ يجب أن ترسل مقطعين صوتيين على الأقل لدمجهما.');
    }
    
    await mergeAudio(ctx, session);
});


bot.hears(/^\/encrypt\s+(\d+)\s+(.+)/s, (ctx) => {
    const complexity = parseInt(ctx.match[1], 10);
    const text = ctx.match[2];

    if (isNaN(complexity) || complexity < 1 || complexity > 10) {
        return ctx.reply('❗ مستوى التعقيد يجب أن يكون رقمًا بين 1 و 10.');
    }
    try {
        const encrypted = customEncrypt(text, complexity);
        ctx.reply(`✅ تم التشفير بنجاح:\n\n\`${encrypted}\`\n\nيمكنك نسخ النص المشفر.`, { parse_mode: 'Markdown' });
    } catch (e) {
        ctx.reply(`❌ حدث خطأ أثناء التشفير: ${e.message}`);
    }
});

bot.hears(/^\/decrypt\s+(ARv6-.+)/s, (ctx) => {
    try {
        const decrypted = customDecrypt(ctx.match[1]);
        ctx.reply(`✅ تم فك التشفير بنجاح:\n\n${decrypted}`);
    } catch (e) {
        ctx.reply(`❌ خطأ في فك التشفير: ${e.message}`);
    }
});

bot.command('skip', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);

  if (!session || session.mode !== 'edit' || !session.audio || !session.title || !session.artist) {
    return ctx.reply('❗ لا يمكنك استخدام هذا الأمر الآن. يرجى إكمال الخطوات السابقة أولاً.');
  }

  await ctx.reply('⏳ جاري تعديل البيانات بدون صورة، يرجى الانتظار...');
  const tempFile = path.join(__dirname, `${userId}_${Date.now()}_edited.mp3`);

  try {
    const fileLink = await ctx.telegram.getFileLink(session.audio.file_id);
    const response = await fetch(fileLink.href);
    const audioBuffer = await response.arrayBuffer();
    fs.writeFileSync(tempFile, Buffer.from(audioBuffer));

    const success = NodeID3.write({ title: session.title, artist: session.artist }, tempFile);
    if (!success) throw new Error('فشل في كتابة بيانات ID3.');

    await ctx.replyWithAudio(
        { source: tempFile },
        { title: session.title, performer: session.artist, caption: '✅ تم تعديل معلومات الأغنية بنجاح!' }
    );
  } catch (err) {
    console.error('Error in /skip command:', err);
    ctx.reply('❌ حدث خطأ أثناء تعديل الملف.');
  } finally {
    userSessions.delete(userId);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

// 4. معالجات الوسائط (صوت، صور)
bot.on('audio', (ctx) => handleAudio(ctx));
bot.on('document', (ctx) => {
  const mime = ctx.message.document.mime_type || '';
  if (mime.startsWith('audio')) {
    handleAudio(ctx);
  } else {
    const session = userSessions.get(ctx.from.id);
    if (session && (session.mode === 'edit' || session.mode === 'trim' || session.mode === 'merge')) {
        ctx.reply('❗ الملف المرسل ليس ملفًا صوتيًا. يرجى إرسال ملف صوتي.');
    }
  }
});

bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);

  if (!session || session.mode !== 'edit' || !session.audio || !session.title || !session.artist) {
    return ctx.reply('❗ لا يمكنك إرسال صورة الآن. يرجى إكمال خطوات تعديل الأغنية أولاً.');
  }

  await ctx.reply('🖼️ تم استلام الصورة، جاري دمجها مع الأغنية...');
  const tempFile = path.join(__dirname, `${userId}_${Date.now()}_final.mp3`);

  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const photoLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageResponse = await fetch(photoLink.href);
    const imageBuffer = await imageResponse.arrayBuffer();

    const audioLink = await ctx.telegram.getFileLink(session.audio.file_id);
    const audioResponse = await fetch(audioLink.href);
    const audioBuffer = await audioResponse.arrayBuffer();
    fs.writeFileSync(tempFile, Buffer.from(audioBuffer));

    const success = NodeID3.write({
      title: session.title,
      artist: session.artist,
      image: {
        mime: 'image/jpeg',
        type: { id: 3, name: 'front cover' },
        description: 'Cover Art',
        imageBuffer: Buffer.from(imageBuffer)
      }
    }, tempFile);
    if (!success) throw new Error('فشل في كتابة بيانات ID3 مع الصورة.');

    await ctx.replyWithAudio(
        { source: tempFile },
        { title: session.title, performer: session.artist, caption: '✅ تم تعديل الأغنية والصورة بنجاح!' }
    );
  } catch (err) {
    console.error('Error in photo handler:', err);
    ctx.reply('❌ حدث خطأ أثناء دمج الصورة مع الملف.');
  } finally {
    userSessions.delete(userId);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

// 5. المعالج العام للرسائل النصية (يأتي في النهاية لضمان عدم تعارضه مع الأوامر)
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  const text = ctx.message.text;

  if (text.startsWith('/')) return;
  if (!session || !session.mode || session.mode === 'crypto' || session.mode === 'merge') return;

  if (session.mode === 'edit') {
    if (!session.audio) return;
    if (!session.title) {
      session.title = text;
      ctx.reply('👤 رائع، الآن أرسل اسم الفنان:');
    } else if (!session.artist) {
      session.artist = text;
      ctx.reply('🖼️ ممتاز! الآن يمكنك إرسال صورة جديدة للأغنية، أو إرسال /skip لتخطي هذه الخطوة.');
    }
  } else if (session.mode === 'trim') {
    if (!session.audio) return;
    if (!session.hasOwnProperty('start')) {
      const startTime = parseFloat(text);
      if (isNaN(startTime) || startTime < 0) {
        return ctx.reply('❌ وقت بداية غير صالح. الرجاء إرسال رقم صحيح (مثل 0 أو 15).');
      }
      session.start = startTime;
      ctx.reply('🛑 حسنًا، الآن أرسل وقت النهاية (بالثواني):');
    } else if (!session.hasOwnProperty('end')) {
      const endTime = parseFloat(text);
      if (isNaN(endTime) || endTime <= session.start) {
        return ctx.reply('❌ وقت نهاية غير صالح. يجب أن يكون رقمًا وأكبر من وقت البداية.');
      }
      session.end = endTime;
      await trimAudio(ctx, session);
    }
  }
  if (userSessions.has(userId)) userSessions.set(userId, session);
});

// --- تشغيل البوت ---
bot.launch();
console.log('🤖 Bot has been launched and is running...');

// معالجة إيقاف البوت بأمان لضمان عدم انقطاع أي عمليات
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

