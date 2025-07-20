// index.js
// هذا الملف يحتوي على منطق بوت تليجرام الذي يستخرج أسئلة MCQ من ملفات المحاضرات.

// استيراد المكتبات الضرورية
const TelegramBot = require('node-telegram-bot-api'); // مكتبة للتفاعل مع Telegram Bot API
const { GoogleGenerativeAI } = require('@google/generative-ai'); // مكتبة Google Gemini AI
const fs = require('fs'); // مكتبة Node.js الأصلية للتعامل مع نظام الملفات
const path = require('path'); // مكتبة Node.js الأصلية للتعامل مع مسارات الملفات
const axios = require('axios'); // مكتبة لعمل طلبات HTTP (تستخدم هنا لتنزيل الملفات من تليجرام)

// --- إعدادات البوت ومفتاح API (مضمنة مباشرة لغرض التجربة فقط) ---
// تحذير: هذا غير آمن لبيئات الإنتاج! استخدم متغيرات البيئة بدلاً من ذلك.
const BOT_TOKEN = '7892395794:AAHy-_f_ej0IT0ZLF1jzdXJDMccLiCrMrZA'; // توكن بوت تليجرام الخاص بك
const GEMINI_API_KEY = 'AIzaSyCtGuhftV0VQCWZpYS3KTMWHoLg__qpO3g'; // مفتاح Google Gemini API الخاص بك

// تهيئة بوت تليجرام
// `polling: true` تعني أن البوت سيبدأ في الاستماع للرسائل الجديدة بشكل مستمر
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('Telegram bot started...'); // رسالة تأكيد عند بدء تشغيل البوت

// تهيئة Google Generative AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// اختيار النموذج الذي سيتم استخدامه. تم التغيير إلى 'gemini-2.5-flash' بناءً على طلبك.
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// --- دوال مساعدة ---

/**
 * تنزيل ملف من تليجرام إلى مجلد مؤقت.
 * @param {string} fileId - معرف الملف (file_id) من رسالة تليجرام.
 * @param {string} fileName - اسم الملف الأصلي.
 * @returns {Promise<string>} - مسار الملف الذي تم تنزيله محليًا.
 */
async function downloadTelegramFile(fileId, fileName) {
    // الحصول على رابط تنزيل الملف من تليجرام
    const fileLink = await bot.getFileLink(fileId);
    // تحديد المسار الذي سيتم حفظ الملف فيه (داخل مجلد 'downloads' في نفس دليل المشروع)
    const filePath = path.join(__dirname, 'downloads', fileName);

    // التأكد من وجود مجلد 'downloads'، وإن لم يكن موجودًا يتم إنشاؤه
    const downloadsDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir);
    }

    // إنشاء تيار كتابة (write stream) لحفظ الملف
    const writer = fs.createWriteStream(filePath);

    // استخدام axios لتنزيل الملف كتيار (stream)
    const response = await axios({
        url: fileLink,
        method: 'GET',
        responseType: 'stream'
    });

    // توجيه تيار البيانات من الاستجابة إلى تيار الكتابة
    response.data.pipe(writer);

    // إرجاع وعد (Promise) يتم حله عند اكتمال تنزيل الملف أو رفضه في حالة حدوث خطأ
    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(filePath)); // عند الانتهاء من الكتابة
        writer.on('error', reject); // في حالة حدوث خطأ
    });
}

/**
 * استخراج النص من ملف. حاليًا يدعم ملفات .txt فقط.
 * يمكن توسيع هذه الدالة لدعم أنواع ملفات أخرى مثل PDF أو DOCX.
 * @param {string} filePath - مسار الملف.
 * @returns {Promise<string>} - النص المستخرج من الملف.
 */
async function extractTextFromFile(filePath) {
    // الحصول على امتداد الملف
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.txt') {
        // قراءة محتوى ملف نصي (UTF-8)
        return fs.promises.readFile(filePath, 'utf8');
    } else if (ext === '.pdf') {
        // رسالة خطأ إذا كان الملف PDF (غير مدعوم حاليًا)
        return Promise.reject(new Error('PDF file processing is not yet implemented. Please send a .txt file.'));
    } else if (ext === '.docx') {
        // رسالة خطأ إذا كان الملف DOCX (غير مدعوم حاليًا)
        return Promise.reject(new Error('DOCX file processing is not yet implemented. Please send a .txt file.'));
    } else {
        // رسالة خطأ لأنواع الملفات غير المدعومة
        return Promise.reject(new Error(`Unsupported file type: ${ext}. Please send a .txt file.`));
    }
}

/**
 * إنشاء أسئلة MCQ باستخدام Google Gemini API.
 * يتم إرسال نص المحاضرة إلى Gemini مع تعليمات لإنشاء الأسئلة بنمط محدد.
 * @param {string} lectureText - النص المستخرج من المحاضرة.
 * @returns {Promise<string>} - أسئلة MCQ المنسقة.
 * @throws {Error} - يرمي خطأ إذا لم يتمكن الذكاء الاصطناعي من إنشاء الأسئلة.
 */
async function generateMCQs(lectureText) {
    // البرومبت (prompt) الذي سيتم إرساله إلى نموذج Gemini AI
    // تم تحديث البرومبت ليكون باللغة الإنجليزية
    const prompt = `Based on the following lecture text, generate 5 Multiple Choice Questions (MCQs) with 4 options (A, B, C, D) and specify the correct answer. The format should be as follows:

Q1: [Question text]?
A) [Option A]
B) [Option B]
C) [Option C]
D) [Option D]
Correct Answer: [A/B/C/D]

---
Lecture Text:
${lectureText}
---
`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text;

        // التحقق مما إذا كان النص الذي تم إنشاؤه فارغًا أو يحتوي على مسافات بيضاء فقط
        if (!text || text.trim().length === 0) {
            throw new Error('The AI could not generate questions from this content. The content might be too short or unclear.');
        }

        return text;
    } catch (error) {
        console.error('An error occurred while generating MCQs using Gemini API:', error);
        // التحقق من نوع الخطأ لتقديم رسالة أكثر تحديدًا
        if (error.response && error.response.candidates && error.response.candidates.length === 0) {
            throw new Error('The AI could not generate questions from this content. The content might be too short or unclear.');
        } else if (error.message && error.message.includes('Text not available')) {
            throw new Error('The AI could not extract valid text. Please ensure the file contains clear text.');
        }
        // رمي الخطأ الأصلي إذا كان غير متوقع
        throw new Error(`Unexpected error from Gemini API: ${error.message || error}`);
    }
}

// --- معالجات أحداث بوت تليجرام ---

// معالجة الأمر /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id; // معرف الدردشة
    bot.sendMessage(chatId, 'مرحبًا! أنا بوت استخراج أسئلة MCQ. أرسل لي ملف محاضرة (حاليًا يدعم ملفات .txt فقط) وسأقوم بإنشاء أسئلة MCQ لك.');
});

// معالجة رسائل المستندات (الملفات المرفقة)
bot.on('document', async (msg) => {
    const chatId = msg.chat.id; // معرف الدردشة
    const document = msg.document; // كائن المستند من رسالة تليجرام
    const fileId = document.file_id; // معرف الملف
    const fileName = document.file_name; // اسم الملف

    // إرسال رسالة للمستخدم لإعلامه بأن الملف قيد المعالجة
    bot.sendMessage(chatId, `تلقيت ملفك: ${fileName}. جاري المعالجة... قد يستغرق هذا بعض الوقت.`);

    let downloadedFilePath; // متغير لتخزين مسار الملف الذي تم تنزيله
    try {
        // 1. تنزيل الملف من تليجرام
        downloadedFilePath = await downloadTelegramFile(fileId, fileName);
        console.log(`تم تنزيل الملف إلى: ${downloadedFilePath}`);

        // 2. استخراج النص من الملف الذي تم تنزيله
        const lectureText = await extractTextFromFile(downloadedFilePath);
        console.log('تم استخراج النص بنجاح. النص المستخرج:', lectureText.substring(0, 200) + '...'); // عرض أول 200 حرف من النص

        // التحقق مما إذا كان النص المستخرج فارغًا
        if (!lectureText || lectureText.trim().length === 0) {
            bot.sendMessage(chatId, 'عذرًا، الملف الذي أرسلته فارغ أو لا يحتوي على نص يمكن استخراجه. يرجى إرسال ملف .txt يحتوي على محتوى.');
            return; // إنهاء المعالجة إذا كان النص فارغًا
        }

        // 3. إنشاء أسئلة MCQ باستخدام Gemini API
        const mcqs = await generateMCQs(lectureText); // هذه الدالة الآن سترمي خطأ إذا فشلت

        // إذا وصلت إلى هنا، فهذا يعني أن mcqs هو نص صالح
        // استخدام `parse_mode: 'Markdown'` لتنسيق النص بشكل أفضل في تليجرام
        bot.sendMessage(chatId, `إليك أسئلة MCQ بناءً على محاضرتك:\n\n${mcqs}`, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('حدث خطأ أثناء معالجة المستند:', error);
        // سيتم التقاط جميع الأخطاء (بما في ذلك الأخطاء التي تم رميها من generateMCQs) هنا
        bot.sendMessage(chatId, `عذرًا، حدث خطأ أثناء معالجة ملفك: ${error.message}. يرجى التأكد من أنه ملف .txt صالح ومحتواه مناسب.`);
    } finally {
        // تنظيف: حذف الملف المؤقت الذي تم تنزيله
        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
            fs.promises.unlink(downloadedFilePath)
                .then(() => console.log(`تم حذف الملف المؤقت: ${downloadedFilePath}`))
                .catch(err => console.error(`خطأ في حذف الملف ${downloadedFilePath}:`, err));
        }
    }
});

// معالجة أي رسائل أخرى غير الأوامر أو المستندات
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    // تجاهل رسائل المستندات والأمر /start هنا لأنها تُعالج بواسطة أحداثها الخاصة
    if (!msg.document && !msg.text.startsWith('/start')) {
        bot.sendMessage(chatId, 'عذرًا، أنا أفهم الأوامر /start والملفات فقط. يرجى إرسال ملف محاضرة (حاليًا يدعم ملفات .txt فقط).');
    }
});

// معالجة أخطاء الاستقصاء (polling errors)
bot.on('polling_error', (error) => {
    console.error('خطأ في الاستقصاء:', error);
});

