# دليل اختبار أوامر Move و Hold

## قبل البدء

تأكد من:
1. ✅ ملف `.env` محدث بـ `GOOGLE_SHEET_RANGE=Master_CSV!A:Z`
2. ✅ Service Account مُعد ولديه صلاحيات الكتابة
3. ✅ صفحة `Master_CSV` موجودة في Google Sheet
4. ✅ عمود Discord-ID موجود في الصفحة
5. ✅ عمود Action (E) موجود في الصفحة

---

## خطوات الاختبار

### 1. اختبار أمر `/move`

**الخطوة 1:** اختر لاعب موجود في Master_CSV
```
/move player:@TestUser clan:RGR
```

**النتيجة المتوقعة:**
- ✅ رسالة نجاح: "Players Moved"
- ✅ "Updated in Master_CSV sheet (Column E: Action)"
- ✅ في Google Sheet: عمود E للاعب = "RGR"

**الخطوة 2:** جرب كلانات مختلفة
```
/move player:@TestUser clan:OTL
/move player:@TestUser clan:RND
```

**التحقق:**
- افتح Google Sheet → Master_CSV
- ابحث عن اللاعب
- تحقق من عمود E (Action)

---

### 2. اختبار أمر `/hold`

**الخطوة 1:** استثنِ لاعب
```
/hold player:@TestUser
```

**النتيجة المتوقعة:**
- ✅ رسالة نجاح: "Players Excluded"
- ✅ "Updated in Master_CSV sheet (Column E: Action = 'Hold')"
- ✅ في Google Sheet: عمود E للاعب = "Hold"

**التحقق:**
- افتح Google Sheet → Master_CSV
- ابحث عن اللاعب
- تحقق من أن عمود E = "Hold"

---

### 3. اختبار أمر `/include`

**الخطوة 1:** أعد لاعب مستثنى
```
/include player:@TestUser
```

**النتيجة المتوقعة:**
- ✅ رسالة نجاح: "Player Included"
- ✅ "Cleared Column E in Master_CSV sheet"
- ✅ في Google Sheet: عمود E للاعب = (فارغ)

**التحقق:**
- افتح Google Sheet → Master_CSV
- ابحث عن اللاعب
- تحقق من أن عمود E فارغ

---

### 4. اختبار السيناريو الكامل

```bash
# 1. استثناء لاعب
/hold player:@Player1

# 2. نقل لاعب
/move player:@Player2 clan:RGR

# 3. توزيع باقي اللاعبين
/swap season:157

# 4. عرض التوزيع
/show

# 5. إعادة لاعب مستثنى
/include player:@Player1

# 6. توزيع مرة أخرى
/swap season:157
```

---

## اختبار الأخطاء

### اختبار 1: لاعب غير موجود
```
/move player:@NonExistentUser clan:RGR
```
**النتيجة المتوقعة:** ❌ "Player with Discord ID not found in Master_CSV"

### اختبار 2: صفحة خاطئة
غيّر `.env` إلى `GOOGLE_SHEET_RANGE=WrongSheet!A:Z`
```
/move player:@TestUser clan:RGR
```
**النتيجة المتوقعة:** ❌ "No data found in Master_CSV sheet"

### اختبار 3: بدون Service Account
احذف أو غيّر `GOOGLE_SERVICE_ACCOUNT_PATH` في `.env`
```
/move player:@TestUser clan:RGR
```
**النتيجة المتوقعة:** ❌ "Write access not available"

---

## قائمة التحقق النهائية

- [ ] أمر `/move` يكتب اسم الكلان في عمود E
- [ ] أمر `/hold` يكتب "Hold" في عمود E
- [ ] أمر `/include` يمسح عمود E
- [ ] الرسائل تشير إلى Master_CSV وليس DiscordMap
- [ ] التوزيع يُحدث تلقائياً بعد كل أمر
- [ ] الأخطاء واضحة ومفيدة

---

## سجلات Console المتوقعة

### عند نجاح `/move`:
```
🔍 Searching for Discord ID: "123456789012345678"
📊 Sheet: Master_CSV
📊 Total rows: 150
📋 Headers: Player_ID | Discord-ID | Name | Trophies | Action
✅ Found Discord-ID column at index 1
Row 1: Discord-ID="123456789012345678" | Full row: P001 | 123456789012345678 | Ahmed | 5000 | 
✅ Found player at row 42
✅ Updated Action for Discord ID 123456789012345678 to "RGR" at Master_CSV!E42
```

### عند نجاح `/hold`:
```
🔍 Searching for Discord ID: "123456789012345678"
📊 Sheet: Master_CSV
✅ Found Discord-ID column at index 1
✅ Found player at row 42
✅ Updated Action for Discord ID 123456789012345678 to "Hold" at Master_CSV!E42
```

### عند نجاح `/include`:
```
🔍 Clearing action for Discord ID: "123456789012345678"
✅ Found Discord-ID column at index 1
✅ Found player at row 42
✅ Cleared Action for Discord ID 123456789012345678 at Master_CSV!E42
```

---

## استكشاف المشاكل الشائعة

### المشكلة: "Discord-ID column not found"
**الحل:**
1. افتح Google Sheet → Master_CSV
2. تحقق من اسم العمود الذي يحتوي على Discord IDs
3. يجب أن يحتوي على كلمة "discord" و "id" (غير حساس لحالة الأحرف)
4. أمثلة صحيحة: "Discord-ID", "Discord_ID", "discord-id", "DISCORD-ID"

### المشكلة: "Player with Discord ID not found"
**الحل:**
1. تحقق من أن Discord ID موجود في عمود Discord-ID
2. استخدم `/map` لربط اللاعب أولاً
3. تأكد من أن Discord ID صحيح (رقم طويل مثل: 123456789012345678)

### المشكلة: الأمر يعمل لكن لا شيء يُكتب في الـ Sheet
**الحل:**
1. تحقق من صلاحيات Service Account
2. تأكد من مشاركة الـ Sheet مع Service Account email
3. تحقق من أن Service Account لديه صلاحيات "Editor"

---

**ملاحظة:** بعد كل تغيير في `.env`، أعد تشغيل البوت!
