// استيراد مكتبة Telegram Bot API
const TelegramBot = require('node-telegram-bot-api');
// استيراد مكتبة تنزيل محتوى انستغرام
const instagramDl = require('instagram-url-dl');

// توكن البوت الخاص بك (تم تضمينه مباشرة كما طلبت)
const token = '7892395794:AAHy-_f_ej0IT0ZLF1jzdXJDMccLiCrMrZA';

// إنشاء مثيل جديد للبوت
// 'polling' يخبر البوت بالتحقق بانتظام من وجود رسائل جديدة
const bot = new TelegramBot(token, { polling: true });

console.log('البوت يعمل...');

// الاستماع لجميع الرسائل الواردة
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;

    // تعبير عادي للتحقق مما إذا كان النص رابط ريلز انستغرام
    // يدعم الروابط التي تبدأ بـ instagram.com/reel/ أو instagr.am/reel/
    const instagramReelRegex = /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/reel\/([a-zA-Z0-9_-]+)\/?/i;

    // التحقق مما إذا كانت الرسالة تطابق نمط رابط انستغرام ريلز
    if (instagramReelRegex.test(messageText)) {
        try {
            // إرسال رسالة للمستخدم لإعلامه بأن التحميل جارٍ
            await bot.sendMessage(chatId, 'جاري تحميل الريل، يرجى الانتظار...');

            // استخدام مكتبة instagram-url-dl للحصول على بيانات الريل
            // قد يستغرق هذا بعض الوقت اعتمادًا على حجم الفيديو وسرعة الشبكة
            const data = await instagramDl(messageText);

            // التحقق مما إذا كان هناك رابط فيديو متاح
            if (data && data.url) {
                // إرسال الفيديو إلى المستخدم
                await bot.sendVideo(chatId, data.url, {
                    caption: 'تم تحميل الريل بنجاح!'
                });
                console.log(`تم إرسال الريل إلى ${chatId}`);
            } else {
                // إرسال رسالة خطأ إذا لم يتم العثور على رابط الفيديو
                await bot.sendMessage(chatId, 'عذرًا، لم أتمكن من العثور على رابط الفيديو للريل هذا. قد يكون الرابط غير صالح أو خاص.');
                console.log(`لم يتم العثور على رابط فيديو للريل: ${messageText}`);
            }
        } catch (error) {
            // التعامل مع الأخطاء التي قد تحدث أثناء عملية التحميل أو الإرسال
            console.error('حدث خطأ أثناء معالجة الريل:', error);
            await bot.sendMessage(chatId, 'عذرًا، حدث خطأ أثناء محاولة تحميل الريل. يرجى التأكد من أن الرابط صحيح وحاول مرة أخرى.');
        }
    } else {
        // الرد على الرسائل التي ليست روابط ريلز انستغرام
        await bot.sendMessage(chatId, 'مرحباً! يرجى إرسال رابط ريلز انستغرام وسأقوم بتحميله لك.');
    }
});

// التعامل مع الأخطاء العامة للبوت (مثل مشاكل الاتصال)
bot.on('polling_error', (error) => {
    console.error('خطأ في البولينج:', error);
});

// التعامل مع الأخطاء التي تحدث أثناء إرسال الرسائل (اختياري)
bot.on('webhook_error', (error) => {
    console.error('خطأ في الويب هوك:', error);
});

