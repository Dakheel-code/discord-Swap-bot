# ⚡ رفع البوت على Railway - دليل سريع

## 🎯 الخطوات (5 دقائق فقط!)

### 1️⃣ رفع على GitHub

```bash
git init
git add .
git commit -m "Discord bot initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

---

### 2️⃣ إنشاء مشروع على Railway

1. اذهب إلى https://railway.app
2. **Login with GitHub**
3. **New Project** → **Deploy from GitHub repo**
4. اختر المشروع
5. **Deploy Now**

---

### 3️⃣ إضافة Environment Variables

اذهب إلى **Variables** وأضف:

```env
DISCORD_TOKEN=YOUR_TOKEN_HERE
GUILD_ID=YOUR_GUILD_ID_HERE
GOOGLE_SHEET_ID=YOUR_SHEET_ID_HERE
GOOGLE_API_KEY=YOUR_API_KEY_HERE
GOOGLE_SHEET_RANGE=Sheet1!A:Z
```

---

### 4️⃣ تحقق من الـ Logs

اذهب إلى **Deployments** → **View Logs**

ابحث عن:
```
✅ Bot logged in as...
🤖 Bot is ready to receive commands!
```

---

## ✅ تم! البوت يعمل 24/7

---

## 📝 ملاحظات مهمة

### ✅ افعل:
- ✅ احتفظ بـ `.env` في مكان آمن
- ✅ راقب استهلاك الموارد
- ✅ اختبر البوت بعد النشر

### ❌ لا تفعل:
- ❌ لا ترفع `.env` على GitHub
- ❌ لا تشارك الـ Tokens مع أحد
- ❌ لا تنسى إضافة Environment Variables

---

## 🔗 روابط سريعة

- **Railway:** https://railway.app
- **الدليل الكامل:** اقرأ `RAILWAY_DEPLOYMENT_AR.md`

---

## 💰 التكلفة

- ✅ $5 مجاناً كل شهر
- ✅ البوت يستهلك $1-3 فقط
- ✅ كافي جداً!

---

## 🆘 مشاكل؟

1. تحقق من الـ **Logs**
2. تأكد من الـ **Environment Variables**
3. اقرأ الدليل الكامل: `RAILWAY_DEPLOYMENT_AR.md`

---

**🎉 استمتع بالبوت!**
