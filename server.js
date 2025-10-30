require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// إعداد Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// إعدادات Twilio
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER;
const client = twilio(accountSid, authToken);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// التحقق من المتغيرات البيئية
if (!accountSid || !authToken || !twilioWhatsAppNumber || !supabaseUrl || !supabaseKey) {
    console.error('❌ بعض المتغيرات البيئية مفقودة');
    process.exit(1);
}

console.log('🗳️ نظام التصويت الذكي جاهز للعمل');

// صفحة رئيسية
app.get('/', (req, res) => {
    res.send(`
    <h1>🗳️ نظام التصويت الذكي</h1>
    <p>✅ الخادم يعمل بنجاح!</p>
    <p>⏰ الوقت الحالي: ${new Date().toLocaleString('ar-IQ')}</p>
    <p>🔗 Webhook URL: ${req.protocol}://${req.get('host')}/webhook</p>
  `);
});

// معالجة الرسائل الواردة
app.post('/webhook', async (req, res) => {
    try {
        const { Body, From, To } = req.body;

        console.log(`📨 رسالة من ${From}: ${Body}`);

        if (!Body) {
            return res.status(200).send('OK');
        }

        await handleVotingConversation(From, Body);
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ خطأ في معالجة الرسالة:', error);
        res.status(500).send('Internal Server Error');
    }
});

// معالجة محادثة التصويت
async function handleVotingConversation(phoneNumber, message) {
    try {
        // الحصول على حالة المستخدم الحالية
        let userSession = await getUserSession(phoneNumber);
        
        // إعادة التشغيل فقط إذا كان مستخدم جديد أو قال كلمة البداية بالضبط
        // وليس في وسط خطوة التقرير
        const isRestartCommand = message.toLowerCase().trim() === 'بداية' || 
                                 message.toLowerCase().trim() === 'ابدأ' || 
                                 message.toLowerCase().trim() === 'تصويت' || 
                                 message.toLowerCase().trim() === 'start';
        
        if (!userSession || isRestartCommand) {
            console.log('🔄 بدء جلسة جديدة أو إعادة تشغيل');
            await startNewSession(phoneNumber);
            userSession = { current_step: 'start' };
        }

        // معالجة حسب الخطوة الحالية
        switch (userSession.current_step) {
            case 'start':
                await handleStartStep(phoneNumber);
                break;
            case 'name':
                await handleNameStep(phoneNumber, message);
                break;
            case 'area':
                await handleAreaStep(phoneNumber, message);
                break;
            case 'center':
                await handleCenterStep(phoneNumber, message);
                break;
            case 'voted':
                await handleVotedStep(phoneNumber, message);
                break;
            case 'count':
                await handleCountStep(phoneNumber, message);
                break;
            case 'report':
                await handleReportStep(phoneNumber, message);
                break;
            case 'completed':
                // السماح بإعادة البداية من حالة completed
                console.log('📝 المستخدم في حالة مكتملة - في انتظار "بداية"');
                await sendMessage(phoneNumber, 'للبدء من جديد، اكتب "بداية"');
                break;
            default:
                await startNewSession(phoneNumber);
        }

        // حفظ الرسالة في السجل
        await logConversation(phoneNumber, message, userSession.current_step);

    } catch (error) {
        console.error('❌ خطأ في معالجة المحادثة:', error);
        await sendMessage(phoneNumber, 'حدث خطأ، يرجى المحاولة مرة أخرى أو كتابة "بداية"');
    }
}

// الحصول على جلسة المستخدم
async function getUserSession(phoneNumber) {
    const { data, error } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('phone_number', phoneNumber)
        .single();
    
    if (error && error.code !== 'PGRST116') {
        console.error('خطأ في جلب جلسة المستخدم:', error);
    }
    
    return data;
}

// بداية جلسة جديدة
async function startNewSession(phoneNumber) {
    const { error } = await supabase
        .from('user_sessions')
        .upsert({
            phone_number: phoneNumber,
            current_step: 'name',
            full_name: null,
            area_name: null,
            voting_center: null,
            has_voted: null,
            voters_count: null,
            user_report: null
        });

    if (error) {
        console.error('خطأ في إنشاء جلسة جديدة:', error);
    }
}

// خطوة البداية
async function handleStartStep(phoneNumber) {
    const welcomeMessage = `🗳️ أهلاً وسهلاً بكم في نظام التصويت الذكي

هذا النظام سيساعدك في تسجيل معلومات التصويت بطريقة منظمة.

يرجى كتابة اسمك الثلاثي للبدء:`;

    await sendMessage(phoneNumber, welcomeMessage);
    await updateUserStep(phoneNumber, 'name');
}

// خطوة الاسم
async function handleNameStep(phoneNumber, message) {
    const cleanName = message.trim();
    
    if (cleanName.length < 6) {
        await sendMessage(phoneNumber, 'يرجى إدخال الاسم الثلاثي كاملاً:');
        return;
    }

    await updateUserSession(phoneNumber, { 
        full_name: cleanName, 
        current_step: 'area' 
    });

    await sendMessage(phoneNumber, `تم حفظ الاسم: ${cleanName}

يرجى ادخال المنطقة:`);
}

// خطوة المنطقة
async function handleAreaStep(phoneNumber, message) {
    const areaName = message.trim();
    
    if (areaName.length < 2) {
        await sendMessage(phoneNumber, 'يرجى إدخال اسم المنطقة:');
        return;
    }

    await updateUserSession(phoneNumber, { 
        area_name: areaName, 
        current_step: 'center' 
    });

    await sendMessage(phoneNumber, `تم حفظ المنطقة: ${areaName}

يرجى ادخال المركز الانتخابي:`);
}

// خطوة المركز
async function handleCenterStep(phoneNumber, message) {
    const centerName = message.trim();

    await updateUserSession(phoneNumber, { 
        voting_center: centerName, 
        current_step: 'voted' 
    });

    await sendMessage(phoneNumber, `تم حفظ المركز: ${centerName}

هل قمت بالتصويت؟

يرجى الإجابة بـ:
• نعم
• لا`);
}

// خطوة التصويت
async function handleVotedStep(phoneNumber, message) {
    const answer = message.toLowerCase().trim();
    
    if (answer.includes('نعم') || answer.includes('yes')) {
        await updateUserSession(phoneNumber, { 
            has_voted: true, 
            current_step: 'count' 
        });

        await sendMessage(phoneNumber, `تم حفظ: نعم - قمت بالتصويت

كم عدد الأشخاص الذين صوتوا معك؟

يرجى كتابة العدد (مثال: 3):`);

    } else if (answer.includes('لا') || answer.includes('no')) {
        await updateUserSession(phoneNumber, { 
            has_voted: false, 
            voters_count: 0,
            user_report: 'لم يقم بالتصويت',
            current_step: 'completed' 
        });

        await generateFinalReport(phoneNumber);

    } else {
        await sendMessage(phoneNumber, 'يرجى الإجابة بـ "نعم" أو "لا" فقط:');
    }
}

// خطوة العدد
async function handleCountStep(phoneNumber, message) {
    let countText = message.trim();
    
    // تحويل الأرقام الهندية (العربية) إلى أرقام إنجليزية
    const arabicNumbers = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    const englishNumbers = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    
    for (let i = 0; i < arabicNumbers.length; i++) {
        countText = countText.replace(new RegExp(arabicNumbers[i], 'g'), englishNumbers[i]);
    }
    
    const count = parseInt(countText);

    if (isNaN(count) || count < 0) {
        await sendMessage(phoneNumber, 'يرجى إدخال رقم صحيح (مثال: 3 أو ٣):');
        return;
    }

    await updateUserSession(phoneNumber, {
        voters_count: count,
        current_step: 'report'
    });

    console.log(`🔄 تم تحديث المستخدم إلى خطوة: report`);

    await sendMessage(phoneNumber, `تم حفظ العدد: ${count}

الآن يرجى كتابة تقرير مختصر عن عملية التصويت:
(مثال: تم التصويت في وقت مبكر، لا توجد مشاكل، الإقبال جيد)`);
}

// خطوة التقرير المكتوب
async function handleReportStep(phoneNumber, message) {
    const userReport = message.trim();

    // إزالة التحقق من طول النص - قبول أي نص حتى لو حرف واحد
    if (userReport.length === 0) {
        await sendMessage(phoneNumber, 'يرجى كتابة شيء في التقرير:');
        return;
    }

    await updateUserSession(phoneNumber, {
        user_report: userReport,
        current_step: 'completed'
    });

    await sendMessage(phoneNumber, `تم حفظ التقرير: ${userReport}

جاري إعداد التقرير النهائي...`);

    await generateFinalReport(phoneNumber);
}

// خطوة الإنتهاء
async function handleCompletedStep(phoneNumber) {
    await sendMessage(phoneNumber, `تم إكمال جميع البيانات مسبقاً.

للبدء من جديد، اكتب "بداية"`);
}

// إنشاء التقرير النهائي
async function generateFinalReport(phoneNumber) {
    try {
        // الحصول على بيانات المستخدم
        const userSession = await getUserSession(phoneNumber);
        
        if (!userSession) {
            await sendMessage(phoneNumber, 'حدث خطأ في جلب البيانات');
            return;
        }

        // حفظ البيانات في جدول السجلات
        const { error: recordError } = await supabase
            .from('voting_records')
            .insert({
                phone_number: phoneNumber,
                full_name: userSession.full_name,
                area_name: userSession.area_name,
                voting_center: userSession.voting_center,
                has_voted: userSession.has_voted,
                voters_count: userSession.voters_count || 0,
                user_report: userSession.user_report || 'لا يوجد تقرير'
            });

        if (recordError) {
            console.error('خطأ في حفظ السجل:', recordError);
        }

        // إنشاء التقرير
        const report = `📋 تقرير التصويت النهائي

👤 الاسم: ${userSession.full_name}
📍 المنطقة: ${userSession.area_name}
🏢 المركز الانتخابي: ${userSession.voting_center}
🗳️ حالة التصويت: ${userSession.has_voted ? '✅ تم التصويت' : '❌ لم يتم التصويت'}
👥 عدد المصوتين معك: ${userSession.voters_count || 0}
📝 التقرير: ${userSession.user_report || 'لا يوجد تقرير'}
📅 تاريخ التسجيل: ${new Date().toLocaleString('ar-IQ')}

✅ تم حفظ بياناتك بنجاح!

شكراً لك على مشاركة هذه المعلومات المهمة.

للبدء من جديد، اكتب "بداية"`;

        await sendMessage(phoneNumber, report);

        // تحديث حالة المستخدم
        await updateUserStep(phoneNumber, 'completed');

    } catch (error) {
        console.error('خطأ في إنشاء التقرير:', error);
        await sendMessage(phoneNumber, 'حدث خطأ في إنشاء التقرير، يرجى المحاولة مرة أخرى');
    }
}

// تحديث خطوة المستخدم
async function updateUserStep(phoneNumber, step) {
    const { error } = await supabase
        .from('user_sessions')
        .update({ current_step: step })
        .eq('phone_number', phoneNumber);

    if (error) {
        console.error('خطأ في تحديث الخطوة:', error);
    }
}

// تحديث جلسة المستخدم
async function updateUserSession(phoneNumber, updates) {
    const { error } = await supabase
        .from('user_sessions')
        .update(updates)
        .eq('phone_number', phoneNumber);

    if (error) {
        console.error('خطأ في تحديث الجلسة:', error);
    }
}

// حفظ المحادثة في السجل
async function logConversation(phoneNumber, userMessage, userStep) {
    const { error } = await supabase
        .from('conversation_logs')
        .insert({
            phone_number: phoneNumber,
            user_message: userMessage,
            user_step: userStep
        });

    if (error) {
        console.error('خطأ في حفظ السجل:', error);
    }
}

// إرسال رسالة
async function sendMessage(to, body) {
    try {
        const message = await client.messages.create({
            body: body,
            from: twilioWhatsAppNumber,
            to: to
        });

        console.log(`✅ تم إرسال رسالة: ${message.sid}`);
        
        // حفظ رد البوت في السجل
        await supabase
            .from('conversation_logs')
            .insert({
                phone_number: to,
                bot_response: body
            });

        return message;
    } catch (error) {
        console.error('❌ خطأ في إرسال الرسالة:', error);
        throw error;
    }
}

// بدء الخادم
app.listen(PORT, () => {
    console.log('🎉 =================================');
    console.log(`🗳️ نظام التصويت الذكي يعمل!`);
    console.log(`🌐 المنفذ: ${PORT}`);
    console.log(`🔗 الرابط المحلي: http://localhost:${PORT}`);
    console.log('🎉 =================================');
});

module.exports = app;
