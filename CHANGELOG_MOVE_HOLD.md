# تغييرات أوامر Move و Hold

## التاريخ: 7 ديسمبر 2025

## التغييرات الرئيسية

### 1. تغيير الصفحة المستهدفة
- **قبل:** كانت الأوامر تكتب في صفحة `DiscordMap` عمود `C`
- **بعد:** الآن تكتب في صفحة `Master_CSV` عمود `E` (Action)

### 2. الأوامر المتأثرة

#### أمر `/move`
- **الوظيفة:** نقل لاعب إلى كلان محدد
- **الكتابة:** يكتب اسم الكلان المختار (RGR, OTL, أو RND) في عمود E
- **مثال:** إذا اخترت نقل لاعب إلى RGR، سيكتب "RGR" في عمود Action

#### أمر `/hold`
- **الوظيفة:** استثناء لاعب من التوزيع
- **الكتابة:** يكتب "Hold" في عمود E
- **مثال:** عند استثناء لاعب، سيكتب "Hold" في عمود Action

#### أمر `/include`
- **الوظيفة:** إعادة لاعب مستثنى إلى التوزيع
- **الكتابة:** يمسح محتوى عمود E (يصبح فارغاً)

### 3. متطلبات الصفحة Master_CSV

يجب أن تحتوي صفحة `Master_CSV` على الأعمدة التالية:

| العمود | الاسم | الوصف |
|--------|-------|-------|
| A | Player_ID | معرف اللاعب |
| B | Discord-ID | معرف Discord للاعب |
| C | Name | اسم اللاعب |
| D | Trophies | نقاط اللاعب |
| **E** | **Action** | **عمود الإجراءات (هنا تُكتب الأوامر)** |

### 4. كيفية عمل الأوامر

1. **البحث:** يبحث البوت عن اللاعب في صفحة `Master_CSV` باستخدام Discord ID
2. **الكتابة:** يكتب في عمود E (Action) للصف المطابق:
   - `/move` → اسم الكلان (RGR/OTL/RND)
   - `/hold` → "Hold"
   - `/include` → فارغ (يمسح المحتوى)

### 5. الملفات المعدلة

#### `src/sheets.js`
- `writePlayerAction()` - تم تعديلها للكتابة في Master_CSV عمود E
- `clearPlayerAction()` - تم تعديلها للمسح من Master_CSV عمود E

#### `src/bot.js`
- تحديث رسائل النجاح لتشير إلى Master_CSV بدلاً من DiscordMap

#### `.env.example`
- تحديث `GOOGLE_SHEET_RANGE` إلى `Master_CSV!A:Z`
- إضافة ملاحظات توضيحية

### 6. رسائل البوت الجديدة

#### عند نجاح `/move`:
```
✅ Players Moved
Moved to RGR:
• PlayerName

✅ Updated in Master_CSV sheet (Column E: Action)
✅ Distribution message updated
```

#### عند نجاح `/hold`:
```
✅ Players Excluded
Excluded:
• PlayerName

✅ Updated in Master_CSV sheet (Column E: Action = "Hold")
✅ Distribution message updated
```

#### عند نجاح `/include`:
```
✅ Player Included
PlayerName has been added back to distribution

✅ Cleared Column E in Master_CSV sheet
✅ Distribution message updated
```

### 7. ملاحظات مهمة

⚠️ **متطلبات:**
- يجب أن يكون لديك Service Account مُعد بشكل صحيح
- يجب أن تكون صفحة `Master_CSV` موجودة في Google Sheet
- يجب أن يحتوي عمود Discord-ID على معرفات Discord الصحيحة

⚠️ **التأكد من الإعدادات:**
1. تحقق من أن `.env` يحتوي على `GOOGLE_SHEET_RANGE=Master_CSV!A:Z`
2. تحقق من أن Service Account لديه صلاحيات الكتابة على الـ Sheet
3. تحقق من أن عمود E في Master_CSV يسمى "Action"

### 8. استكشاف الأخطاء

#### خطأ: "No data found in Master_CSV sheet"
- **السبب:** الصفحة غير موجودة أو الاسم خاطئ
- **الحل:** تأكد من أن اسم الصفحة هو `Master_CSV` بالضبط

#### خطأ: "Discord-ID column not found"
- **السبب:** لا يوجد عمود باسم Discord-ID
- **الحل:** أضف عمود Discord-ID في الصفحة

#### خطأ: "Player with Discord ID not found"
- **السبب:** Discord ID غير موجود في الصفحة
- **الحل:** استخدم أمر `/map` لربط اللاعب أولاً

---

## للمطورين

### كود الكتابة في عمود E:
```javascript
// Write to column E (Action) - E is index 4 (A=0, B=1, C=2, D=3, E=4)
const range = `Master_CSV!E${rowIndex}`;

await sheetsClientWithAuth.spreadsheets.values.update({
  spreadsheetId: config.googleSheets.sheetId,
  range: range,
  valueInputOption: 'RAW',
  resource: { values: [[action]] },
});
```

### البحث عن اللاعب:
```javascript
// Find player row by Discord ID
for (let i = 1; i < rows.length; i++) {
  const rowDiscordId = rows[i][discordIdColumn];
  if (rowDiscordId && String(rowDiscordId).trim() === String(discordId).trim()) {
    rowIndex = i + 1; // +1 because sheets are 1-indexed
    break;
  }
}
```
