// index.js
// هذا الملف يحتوي على منطق بوت تليجرام الذي يجيب على الأسئلة النصية باستخدام Google Gemini AI.

// استيراد المكتبات الضرورية
const TelegramBot = require('node-telegram-bot-api'); // مكتبة للتفاعل مع Telegram Bot API
const { GoogleGenerativeAI } = require('@google/generative-ai'); // مكتبة Google Gemini AI

// --- إعدادات البوت ومفتاح API (مضمنة مباشرة لغرض التجربة فقط) ---
// تحذير: هذا غير آمن لبيئات الإنتاج! استخدم متغيرات البيئة بدلاً من ذلك.
const BOT_TOKEN = '7892395794:AAHy-_f_ej0IT0ZLF1jzdXJDMccLiCrMrZA'; // توكن بوت تليجرام الخاص بك
const GEMINI_API_KEY = 'AIzaSyCtGuhftV0VQCWZpYS3KTMWHoLg__qpO3g'; // مفتاح Google Gemini API الخاص بك

// تهيئة بوت تليجرام
// `polling: true` تعني أن البوت سيبدأ في الاستماع للرسائل الجديدة بشكل مستمر
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('Telegram AI Chat bot started...'); // رسالة تأكيد عند بدء تشغيل البوت

// تهيئة Google Generative AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// اختيار النموذج الذي سيتم استخدامه. 'gemini-2.5-flash' هو نموذج سريع وفعال.
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// --- دالة مساعدة ---

/**
 * توليد استجابة من Google Gemini AI بناءً على استعلام المستخدم.
 * @param {string} userQuery - استعلام المستخدم النصي.
 * @returns {Promise<string>} - الاستجابة النصية من الذكاء الاصطناعي.
 * @throws {Error} - يرمي خطأ إذا لم يتمكن الذكاء الاصطناعي من توليد استجابة.
 */
async function generateAIResponse(userQuery) {
    try {
        // استدعاء نموذج Gemini AI لتوليد المحتوى
        const result = await model.generateContent(userQuery);
        const response = await result.response;
        const text = response.text;

        // التحقق مما إذا كان النص الذي تم إنشاؤه فارغًا أو يحتوي على مسافات بيضاء فقط
        if (!text || text.trim().length === 0) {
            throw new Error('لم يتمكن الذكاء الاصطناعي من توليد إجابة لهذا السؤال. يرجى المحاولة بسؤال آخر.');
        }

        return text;
    } catch (error) {
        console.error('حدث خطأ أثناء توليد استجابة من Gemini AI:', error);
        // التحقق من نوع الخطأ لتقديم رسالة أكثر تحديدًا
        if (error.response && error.response.candidates && error.response.candidates.length === 0) {
            throw new Error('لم يتمكن الذكاء الاصطناعي من توليد إجابة لهذا السؤال. قد يكون السؤال غير واضح أو ينتهك سياسات المحتوى.');
        } else if (error.message && error.message.includes('Text not available')) {
            throw new Error('لم يتمكن الذكاء الاصطناعي من استخراج نص صالح. يرجى التأكد من أن سؤالك واضح.');
        }
        // رمي الخطأ الأصلي إذا كان غير متوقع
        throw new Error(`خطأ غير متوقع من الذكاء الاصطناعي: ${error.message || error}`);
    }
}

// --- معالجات أحداث بوت تليجرام ---

// معالجة الأمر /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id; // معرف الدردشة
    bot.sendMessage(chatId, 'مرحبًا! أنا بوت تصفح ذكي. أرسل لي أي سؤال نصي وسأحاول الإجابة عليه باستخدام الذكاء الاصطناعي.');
});

// معالجة جميع الرسائل النصية الواردة
bot.on('text', async (msg) => {
    const chatId = msg.chat.id; // معرف الدردشة
    const userQuery = msg.text; // نص رسالة المستخدم

    // تجاهل الأمر /start هنا لأنه يتم معالجته بواسطة bot.onText
    if (userQuery.startsWith('/start')) {
        return;
    }

    // إرسال "جاري الكتابة..." لتحسين تجربة المستخدم
    await bot.sendChatAction(chatId, 'typing');

    try {
        // توليد استجابة من الذكاء الاصطناعي
        const aiResponse = await generateAIResponse(userQuery);

        // إرسال الاستجابة إلى المستخدم
        bot.sendMessage(chatId, aiResponse);

    } catch (error) {
        console.error('حدث خطأ أثناء معالجة رسالة المستخدم:', error);
        // إرسال رسالة خطأ للمستخدم
        bot.sendMessage(chatId, `عذرًا، حدث خطأ أثناء معالجة سؤالك: ${error.message}. يرجى المحاولة مرة أخرى لاحقًا.`);
    }
});

// معالجة أي رسائل غير نصية (مثل الصور، الملفات، إلخ)
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    // إذا لم تكن الرسالة نصية (مثل ملف أو صورة)، أرسل رسالة توضيحية
    if (!msg.text) {
        bot.sendMessage(chatId, 'عذرًا، أنا أفهم الأسئلة النصية فقط. يرجى إرسال سؤالك كنص.');
    }
});

// معالجة أخطاء الاستقصاء (polling errors)
bot.on('polling_error', (error) => {
    console.error('خطأ في الاستقصاء:', error);
});

