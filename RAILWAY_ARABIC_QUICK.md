# 🚂 رفع البوت على Railway - سريع وبسيط

## ⚡ 3 خطوات فقط!

---

## 1️⃣ رفع على GitHub

**افتح Terminal في مجلد المشروع واكتب:**

```bash
git init
git add .
git commit -m "Discord bot"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

**استبدل `YOUR_USERNAME` و `YOUR_REPO` بالقيم الصحيحة!**

---

## 2️⃣ نشر على Railway

1. اذهب إلى: **https://railway.app**
2. اضغط **"Login with GitHub"**
3. اضغط **"New Project"**
4. اختر **"Deploy from GitHub repo"**
5. اختر المشروع
6. اضغط **"Deploy Now"**

---

## 3️⃣ إضافة المتغيرات

**اذهب إلى Variables وأضف:**

```
DISCORD_TOKEN=YOUR_TOKEN
GUILD_ID=YOUR_GUILD_ID
GOOGLE_SHEET_ID=YOUR_SHEET_ID
GOOGLE_API_KEY=YOUR_API_KEY
GOOGLE_SHEET_RANGE=Sheet1!A:Z
```

**استبدل القيم بالقيم الصحيحة من ملف `.env` الخاص بك!**

---

## ✅ تحقق من النجاح

**اذهب إلى Deployments → View Logs**

**ابحث عن:**
```
✅ Bot logged in as...
🤖 Bot is ready to receive commands!
```

---

## 🎉 تم! البوت يعمل 24/7

**جرب على Discord:**
- `/help`
- `/swap season:157`

---

## 🔄 للتحديثات

```bash
git add .
git commit -m "تحديث"
git push
```

Railway سيحدث تلقائياً! 🚀

---

## 📝 ملاحظات مهمة

### كيف تحصل على DISCORD_TOKEN:
1. https://discord.com/developers/applications
2. اختر البوت → Bot → Reset Token

### كيف تحصل على GUILD_ID:
1. Discord → Settings → Advanced → Developer Mode
2. انقر بزر الماوس الأيمن على السيرفر → Copy Server ID

### كيف تحصل على GOOGLE_SHEET_ID:
من رابط الجدول:
```
https://docs.google.com/spreadsheets/d/[هذا_هو_الـID]/edit
```

### كيف تحصل على GOOGLE_API_KEY:
1. https://console.cloud.google.com
2. APIs & Services → Credentials → Create Credentials → API Key

---

## ❓ مشاكل؟

### البوت لا يظهر أونلاين:
- تحقق من DISCORD_TOKEN
- فعل Intents في Discord Developer Portal

### خطأ في Google Sheets:
- تحقق من GOOGLE_SHEET_ID
- تحقق من GOOGLE_API_KEY
- فعل Google Sheets API

### البوت توقف:
- شاهد Logs على Railway
- تحقق من استهلاك الموارد

---

## 🔗 روابط سريعة

- **Railway:** https://railway.app
- **Discord Developers:** https://discord.com/developers
- **Google Cloud:** https://console.cloud.google.com

---

## 📖 أدلة أخرى

- `RAILWAY_STEP_BY_STEP.md` - دليل مفصل مع شرح
- `DEPLOYMENT_CHECKLIST.md` - قائمة تحقق كاملة
- `RAILWAY_COMMANDS.txt` - الأوامر فقط

---

**🎊 مبروك! البوت شغال 24/7**
