// استيراد مكتبة Telegraf لإنشاء بوت تليجرام
const { Telegraf } = require('telegraf');
// استيراد مكتبة GoogleGenerativeAI للتفاعل مع نموذج Gemini AI
const { GoogleGenerativeAI } = require('@google/generative-ai');

// *** المتغيرات الشخصية الخاصة بك ***
// توكن بوت تليجرام الخاص بك
// يرجى ملاحظة: في بيئات الإنتاج، يفضل استخدام متغيرات البيئة (environment variables) بدلاً من تضمينها مباشرة في الكود لأسباب أمنية.
const BOT_TOKEN = '7892395794:AAHy-_f_ej0IT0ZLF1jzdXJDMccLiCrMrZA';
// مفتاح API الخاص بنموذج Gemini AI
const GEMINI_API_KEY = 'AIzaSyCtGuhftV0VQCWZpYS3KTMWHoLg__qpO3g';
// *** نهاية المتغيرات الشخصية ***

// تهيئة بوت تليجرام باستخدام التوكن الخاص بك
const bot = new Telegraf(BOT_TOKEN);

// تهيئة GoogleGenerativeAI باستخدام مفتاح الـ API الخاص بك
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// اختيار نموذج Gemini Pro
// يمكنك تجربة نماذج أخرى إذا كانت متاحة وتناسب احتياجاتك
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// معالج الرسائل النصية
// سيتم تشغيل هذا الكود عندما يرسل المستخدم أي رسالة نصية إلى البوت
bot.on('text', async (ctx) => {
    const userMessage = ctx.message.text; // الحصول على رسالة المستخدم

    console.log(`Received message from ${ctx.from.username || ctx.from.first_name}: ${userMessage}`);

    // إرسال رسالة "جاري الكتابة..." لإظهار أن البوت يعالج الطلب
    ctx.telegram.sendChatAction(ctx.chat.id, 'typing');

    try {
        // إنشاء محادثة جديدة مع النموذج
        const chat = model.startChat({
            // يمكنك توفير تاريخ محادثة هنا إذا كنت تريد أن يتذكر النموذج السياق السابق
            // history: [
            //   {
            //     role: "user",
            //     parts: "مرحبا",
            //   },
            //   {
            //     role: "model",
            //     parts: "أهلاً بك! كيف يمكنني مساعدتك اليوم؟",
            //   },
            // ],
            generationConfig: {
                maxOutputTokens: 500, // تحديد الحد الأقصى لعدد التوكنات في الاستجابة
            },
        });

        // إرسال رسالة المستخدم إلى نموذج Gemini والحصول على الاستجابة
        const result = await chat.sendMessage(userMessage);
        const response = await result.response;
        const text = response.text(); // استخراج النص من استجابة النموذج

        console.log(`Gemini response: ${text}`);

        // إرسال استجابة Gemini إلى المستخدم
        ctx.reply(text);
    } catch (error) {
        console.error('Error interacting with Gemini AI:', error);
        // إرسال رسالة خطأ إلى المستخدم إذا حدث مشكلة
        ctx.reply('عذراً، حدث خطأ أثناء معالجة طلبك. يرجى المحاولة مرة أخرى لاحقاً.');
    }
});

// معالج أمر /start
// سيتم تشغيل هذا الكود عندما يرسل المستخدم الأمر /start
bot.start((ctx) => {
    ctx.reply('مرحباً بك! أنا بوت يتحدث مع الذكاء الاصطناعي Gemini. أرسل لي أي شيء لنتحدث!');
});

// معالج أمر /help
// سيتم تشغيل هذا الكود عندما يرسل المستخدم الأمر /help
bot.help((ctx) => {
    ctx.reply('يمكنك إرسال أي رسالة نصية وسأقوم بالرد عليك باستخدام الذكاء الاصطناعي. استمتع!');
});

// تشغيل البوت
bot.launch()
    .then(() => console.log('Telegram bot started!'))
    .catch(err => console.error('Failed to start Telegram bot:', err));

// تمكين الإيقاف النظيف في حالة إغلاق التطبيق (مثل Ctrl+C)
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

