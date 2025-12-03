# 🚀 البدء السريع

## الخطوات الأساسية (5 دقائق)

### 1️⃣ تثبيت المكتبات
```bash
npm install
```

### 2️⃣ إنشاء ملف .env
```bash
copy .env.example .env
```

### 3️⃣ تعديل ملف .env
افتح `.env` وأضف:
```env
DISCORD_TOKEN=توكن_البوت_من_Discord
GUILD_ID=معرف_السيرفر
GOOGLE_SHEET_ID=معرف_الشيت_من_Google
GOOGLE_SHEET_RANGE=Sheet1!A:Z
GOOGLE_CREDENTIALS_PATH=./credentials.json
```

### 4️⃣ إضافة ملف credentials.json
ضع ملف `credentials.json` من Google Cloud في مجلد المشروع

### 5️⃣ تشغيل البوت
```bash
npm start
```

---

## ✅ التحقق من التشغيل

إذا رأيت هذه الرسائل، فكل شيء يعمل:
```
✅ Google Sheets API initialized successfully
✅ Bot logged in as YourBot#1234
✅ Registered guild commands
🤖 Bot is ready to receive commands!
```

---

## 🎮 جرّب الآن!

في Discord، اكتب:
```
/columns
```
يجب أن يعرض لك الأعمدة من Google Sheet

ثم:
```
/distribute [اسم_العمود]
```
مثال:
```
/distribute Kills
```

---

## ❌ إذا واجهت مشكلة

### المشكلة: "DISCORD_TOKEN is not set"
**الحل:** تأكد من إضافة التوكن في ملف `.env`

### المشكلة: "Failed to initialize Google Sheets"
**الحل:** 
1. تأكد من وجود `credentials.json`
2. تأكد من مشاركة الشيت مع البريد من `credentials.json`

### المشكلة: "No data found in sheet"
**الحل:** تأكد من أن الشيت يحتوي على بيانات

---

## 📚 للمزيد من التفاصيل

- **دليل الإعداد الكامل:** اقرأ `SETUP_AR.md`
- **أمثلة الاستخدام:** اقرأ `EXAMPLES.md`
- **هيكل المشروع:** اقرأ `PROJECT_STRUCTURE.md`

---

## 🔗 روابط مهمة

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Discord.js Documentation](https://discord.js.org/)
- [Google Sheets API](https://developers.google.com/sheets/api)
