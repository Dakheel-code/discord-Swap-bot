# إعداد Service Account على Railway

## المشكلة
```
Error: Write access not available. Please configure Service Account credentials in .env file (GOOGLE_SERVICE_ACCOUNT_PATH)
```

هذا الخطأ يظهر لأن البوت لا يملك صلاحيات الكتابة على Google Sheets.

## الحل

### الخطوة 1: احصل على ملف Service Account

1. اذهب إلى [Google Cloud Console](https://console.cloud.google.com/)
2. اختر مشروعك (أو أنشئ مشروع جديد)
3. اذهب إلى **APIs & Services** > **Credentials**
4. اضغط **Create Credentials** > **Service Account**
5. املأ البيانات واضغط **Create**
6. اذهب إلى **Keys** > **Add Key** > **Create New Key**
7. اختر **JSON** واضغط **Create**
8. سيتم تحميل ملف `credentials.json`

### الخطوة 2: شارك Google Sheet مع Service Account

1. افتح ملف `credentials.json`
2. انسخ قيمة `client_email` (مثل: `bot@project.iam.gserviceaccount.com`)
3. افتح Google Sheet الخاص بك
4. اضغط **Share** (مشاركة)
5. الصق الـ email وأعطه صلاحية **Editor**
6. اضغط **Send**

### الخطوة 3: أضف Service Account إلى Railway

#### الطريقة الموصى بها: Environment Variable

1. **افتح ملف `credentials.json`** على جهازك
2. **انسخ كامل محتوى الملف** (JSON كامل)
3. **اذهب إلى Railway Dashboard:**
   - افتح مشروع البوت
   - اذهب إلى **Variables** (في القائمة الجانبية)
   - اضغط **+ New Variable**

4. **أضف المتغير:**
   ```
   Variable Name: GOOGLE_SERVICE_ACCOUNT_JSON
   Variable Value: [الصق كامل محتوى credentials.json هنا]
   ```

5. **احفظ التغييرات**
6. **انتظر إعادة تشغيل البوت** (2-3 دقائق)

### الخطوة 4: تحقق من نجاح الإعداد

1. **افتح Railway Logs**
2. **ابحث عن هذه الرسالة:**
   ```
   ✅ Service Account loaded from environment variable
   ✅ Google Sheets API initialized with write access
   ```

3. **جرب الأوامر:**
   ```
   /map ingame_id:TestPlayer discord_id:@YourUsername
   /move player:@YourUsername clan:RGR
   /hold player:@YourUsername
   ```

## استكشاف الأخطاء

### الخطأ: "Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON"
- **السبب:** محتوى JSON غير صحيح
- **الحل:** تأكد من نسخ كامل محتوى الملف بدون تعديل

### الخطأ: "Permission denied"
- **السبب:** Service Account لا يملك صلاحيات على Google Sheet
- **الحل:** شارك الـ Sheet مع Service Account email

### الخطأ: "Service Account not configured"
- **السبب:** المتغير غير موجود أو الاسم خاطئ
- **الحل:** تأكد من اسم المتغير: `GOOGLE_SERVICE_ACCOUNT_JSON`

## ملاحظات مهمة

1. ⚠️ **لا ترفع ملف credentials.json إلى GitHub** - استخدم Environment Variables فقط
2. ✅ **البوت يدعم طريقتين:**
   - Environment Variable: `GOOGLE_SERVICE_ACCOUNT_JSON` (للـ Railway/Heroku)
   - File Path: `GOOGLE_SERVICE_ACCOUNT_PATH` (للتطوير المحلي)
3. 🔒 **احتفظ بملف credentials.json آمناً** - لا تشاركه مع أحد

## الأوامر التي تحتاج Write Access

- `/map` - ربط اللاعبين بحساباتهم
- `/move` - نقل اللاعبين بين الكلانات
- `/hold` - استبعاد اللاعبين
- `/include` - إعادة إدراج اللاعبين
- `/reset` - إعادة تعيين جميع الأوامر
