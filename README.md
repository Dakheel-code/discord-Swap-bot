# Discord Player Distribution Bot

بوت Discord لتوزيع اللاعبين إلى مجموعات من Google Sheets

## المميزات

- قراءة بيانات اللاعبين من Google Sheets
- توزيع اللاعبين تلقائياً إلى 3 مجموعات (RGR, OTL, RND)
- كل مجموعة تحتوي على 50 لاعب
- إمكانية تعديل التوزيع يدوياً
- نقل اللاعبين بين المجموعات
- استثناء لاعبين من التوزيع

## الإعداد

### 1. تثبيت المتطلبات

```bash
npm install
```

### 2. إعداد Discord Bot

1. اذهب إلى [Discord Developer Portal](https://discord.com/developers/applications)
2. أنشئ تطبيق جديد
3. اذهب إلى قسم "Bot" وأنشئ بوت
4. فعّل "MESSAGE CONTENT INTENT" في Bot Settings
5. انسخ التوكن

### 3. إعداد Google Sheets API

1. اذهب إلى [Google Cloud Console](https://console.cloud.google.com/)
2. أنشئ مشروع جديد
3. فعّل Google Sheets API
4. أنشئ Service Account
5. حمّل ملف JSON للـ credentials
6. شارك Google Sheet مع البريد الإلكتروني للـ Service Account

### 4. إعداد ملف البيئة

انسخ `.env.example` إلى `.env` وأضف بياناتك:

```bash
cp .env.example .env
```

### 5. تشغيل البوت

```bash
npm start
```

## الأوامر

### `/distribute [column_name]`
توزيع اللاعبين إلى المجموعات بناءً على عمود معين

**مثال:**
```
/distribute kills
```

### `/move [player_name] [target_group]`
نقل لاعب إلى مجموعة محددة

**مثال:**
```
/move Ahmed RGR
```

### `/exclude [player_name]`
استثناء لاعب من التوزيع

**مثال:**
```
/exclude Ahmed
```

### `/include [player_name]`
إعادة لاعب مستثنى إلى التوزيع

**مثال:**
```
/include Ahmed
```

### `/show`
عرض التوزيع الحالي للمجموعات

### `/refresh`
تحديث البيانات من Google Sheets

## هيكل Google Sheet المتوقع

يجب أن يحتوي الـ Sheet على:
- عمود للأسماء (مثل: "Name" أو "Player")
- أعمدة للإحصائيات (مثل: "Kills", "Points", "Score", إلخ)

مثال:

| Name  | Kills | Deaths | Points |
|-------|-------|--------|--------|
| Ahmed | 150   | 50     | 1500   |
| Sara  | 120   | 60     | 1200   |
| ...   | ...   | ...    | ...    |

## الترخيص

MIT
