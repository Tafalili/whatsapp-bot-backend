require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// إعداد Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// إعدادات 360Dialog
const dialog360ApiKey = process.env.DIALOG360_API_KEY;
const dialog360PhoneNumber = process.env.DIALOG360_PHONE_NUMBER;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// التحقق من المتغيرات البيئية
if (!dialog360ApiKey || !dialog360PhoneNumber || !supabaseUrl || !supabaseKey) {
    console.error('❌ بعض المتغيرات البيئية مفقودة');
    console.error('API Key:', dialog360ApiKey ? '✅' : '❌');
    console.error('Phone Number:', dialog360PhoneNumber ? '✅' : '❌');
    console.error('Supabase URL:', supabaseUrl ? '✅' : '❌');
    console.error('Supabase Key:', supabaseKey ? '✅' : '❌');
    process.exit(1);
}

console.log('🗳️ نظام التصويت الذكي جاهز للعمل (360Dialog)');
console.log('📞 رقم الهاتف:', dialog360PhoneNumber);

// صفحة رئيسية
app.get('/', (req, res) => {
    res.send(`
    <h1>🗳️ نظام التصويت الذكي (360Dialog)</h1>
    <p>✅ الخادم يعمل بنجاح!</p>
    <p>⏰ الوقت الحالي: ${new Date().toLocaleString('ar-IQ')}</p>
    <p>🔗 Webhook URL: ${req.protocol}://${req.get('host')}/webhook</p>
    <p>📞 رقم WhatsApp: ${dialog360PhoneNumber}</p>
  `);
});

// إضافة endpoint للتحقق من الـ webhook (GET request)
app.get('/webhook', (req, res) => {
    console.log('🔍 Webhook verification request received');
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === 'voter_bot_verify_2024') {
            console.log('✅ Webhook verified');
            res.status(200).send(challenge);
        } else {
            console.log('❌ Webhook verification failed');
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(404);
    }
});

// معالجة الرسائل الواردة من 360Dialog
app.post('/webhook', async (req, res) => {
    try {
        console.log('📨 Webhook received:', JSON.stringify(req.body, null, 2));

        // التحقق من وجود البيانات في المكان الصحيح
        if (req.body.entry && req.body.entry[0] && 
            req.body.entry[0].changes && req.body.entry[0].changes[0] && 
            req.body.entry[0].changes[0].value && 
            req.body.entry[0].changes[0].value.messages) {
            
            const messages = req.body.entry[0].changes[0].value.messages;
            
            for (const message of messages) {
                // معالجة الرسائل النصية فقط
                if (message.type === 'text') {
                    const from = message.from; // رقم المرسل
                    const text = message.text.body;
                    
                    console.log(`📨 رسالة من ${from}: ${text}`);
                    
                    await handleVotingConversation(from, text);
                }
            }
        } else {
            console.log('⚠️ لا توجد رسائل في هذا الطلب');
        }

        res.status(200).json({ status: 'success' });
    } catch (error) {
        console.error('❌ خطأ في معالجة الرسالة:', error);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// endpoint لاختبار الإرسال
app.post('/test-send', async (req, res) => {
    try {
        const { to, message } = req.body;
        const testNumber = to || '9647838690292';
        const testMessage = message || 'رسالة تجريبية من البوت 🤖';
        
        console.log(`🧪 اختبار الإرسال إلى: ${testNumber}`);
        const result = await sendMessage(testNumber, testMessage);
        
        res.json({ 
            success: true, 
            result,
            sentTo: testNumber,
            message: testMessage
        });
    } catch (error) {
        console.error('❌ فشل الاختبار:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.response?.data 
        });
    }
});

// معالجة محادثة التصويت
async function handleVotingConversation(phoneNumber, message) {
    try {
        console.log(`🔄 معالجة رسالة من ${phoneNumber}: "${message}"`);
        
        // الحصول على حالة المستخدم الحالية
        let userSession = await getUserSession(phoneNumber);
        
        // إعادة التشغيل فقط إذا كان مستخدم جديد أو قال كلمة البداية بالضبط
        const isRestartCommand = message.toLowerCase().trim() === 'بداية' || 
                                 message.toLowerCase().trim() === 'ابدأ' || 
                                 message.toLowerCase().trim() === 'تصويت' || 
                                 message.toLowerCase().trim() === 'start';
        
        if (!userSession || isRestartCommand) {
            console.log('🔄 بدء جلسة جديدة أو إعادة تشغيل');
            await startNewSession(phoneNumber);
            userSession = { current_step: 'start' };
        }

        console.log(`📊 الخطوة الحالية للمستخدم: ${userSession.current_step}`);

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
                console.log('📝 المستخدم في حالة مكتملة - في انتظار "بداية"');
                await sendMessage(phoneNumber, 'للبدء من جديد، اكتب "بداية"');
                break;
            default:
                console.log(`⚠️ خطوة غير معروفة: ${userSession.current_step}`);
                await startNewSession(phoneNumber);
                await handleStartStep(phoneNumber);
        }

        // حفظ الرسالة في السجل
        await logConversation(phoneNumber, message, userSession.current_step);

    } catch (error) {
        console.error('❌ خطأ في معالجة المحادثة:', error);
        console.error('Stack trace:', error.stack);
        
        try {
            await sendMessage(phoneNumber, 'حدث خطأ، يرجى المحاولة مرة أخرى أو كتابة "بداية"');
        } catch (sendError) {
            console.error('❌ فشل إرسال رسالة الخطأ:', sendError);
        }
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

يرجى كتابة العدد (مثال: 3 أو ٣):`);

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

// إنشاء التقرير النهائي
async function generateFinalReport(phoneNumber) {
    try {
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

// إرسال رسالة عبر 360Dialog - النسخة المُصححة
async function sendMessage(to, body) {
    try {
        console.log(`📲 محاولة إرسال رسالة إلى: ${to}`);
        console.log(`📝 محتوى الرسالة: ${body.substring(0, 50)}...`);
        
        // التأكد من تنسيق رقم الهاتف (يجب أن يكون بدون + أو أصفار إضافية)
        let formattedNumber = to.replace(/\D/g, ''); // إزالة أي رموز غير رقمية
        
        // إزالة الصفر الأولي إذا كان موجود (لأرقام العراق)
        if (formattedNumber.startsWith('0')) {
            formattedNumber = formattedNumber.substring(1);
        }
        
        // التأكد من أن الرقم يبدأ بكود الدولة
        if (!formattedNumber.startsWith('964')) {
            console.log('⚠️ إضافة كود الدولة للرقم');
            formattedNumber = '964' + formattedNumber;
        }
        
        console.log(`📞 الرقم المنسق: ${formattedNumber}`);
        
        const requestBody = {
            messaging_product: "whatsapp",
            to: formattedNumber,
            type: "text",
            text: {
                body: body
            }
        };

        console.log('🔧 جسم الطلب:', JSON.stringify(requestBody, null, 2));

        const response = await axios.post(
            'https://waba-v2.360dialog.io/v1/messages',
            requestBody,
            {
                headers: {
                    'D360-API-KEY': dialog360ApiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 10000 // timeout 10 ثواني
            }
        );

        console.log('✅ تم إرسال الرسالة بنجاح');
        console.log('📬 Response:', JSON.stringify(response.data, null, 2));
        
        if (response.data.messages && response.data.messages[0]) {
            console.log(`✅ Message ID: ${response.data.messages[0].id}`);
        }
        
        // حفظ رد البوت في السجل
        try {
            await supabase
                .from('conversation_logs')
                .insert({
                    phone_number: to,
                    bot_response: body
                });
        } catch (dbError) {
            console.error('⚠️ خطأ في حفظ السجل:', dbError);
        }

        return response.data;
    } catch (error) {
        console.error('❌ خطأ في إرسال الرسالة:');
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', JSON.stringify(error.response.data, null, 2));
            
            // معالجة أخطاء محددة
            if (error.response.status === 401) {
                console.error('⚠️ خطأ في المصادقة - API Key غير صحيح');
            } else if (error.response.status === 400) {
                console.error('⚠️ خطأ في تنسيق الطلب - تحقق من بنية الرسالة');
                console.error('💡 تأكد أن المستخدم بدأ المحادثة أولاً');
            } else if (error.response.status === 403) {
                console.error('⚠️ الرقم غير مسموح - قد يحتاج المستخدم لبدء المحادثة أولاً');
            } else if (error.response.status === 404) {
                console.error('⚠️ الرقم غير موجود أو غير صالح');
            }
        } else if (error.code === 'ECONNABORTED') {
            console.error('⚠️ انتهت مهلة الطلب - timeout');
        } else {
            console.error('Error:', error.message);
        }
        throw error;
    }
}

// بدء الخادم
app.listen(PORT, () => {
    console.log('🎉 =================================');
    console.log(`🗳️ نظام التصويت الذكي يعمل! (360Dialog)`);
    console.log(`🌐 المنفذ: ${PORT}`);
    console.log(`🔗 الرابط المحلي: http://localhost:${PORT}`);
    console.log(`📱 رقم WhatsApp: ${dialog360PhoneNumber}`);
    console.log('🎉 =================================');
});

module.exports = app;
