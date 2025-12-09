# تحديث: عرض أسماء اللاعبين كـ Mentions في رسالة Swap

## 📝 الوصف

تم تحديث النظام ليعرض أسماء اللاعبين في رسالة `/swap` كـ **Discord mentions** (تاغات) بدلاً من أسماء عادية، بحيث يتم ربطهم مع Discord IDs من صفحة DiscordMap.

## 🔄 التغييرات

### قبل التحديث ❌
```
• DYLAN ★ - 6064
• Cornish ☆RGR☆ - 5984
• BigPapi RGR - 5969
```

### بعد التحديث ✅
```
• @DYLAN - 6064
• @Cornish - 5984
• @BigPapi - 5969
```

أو إذا كان Discord-ID موجود:
```
• <@123456789> - 6064  (يظهر كـ mention حقيقي في Discord)
• <@987654321> - 5984
• <@456789123> - 5969
```

## 📊 هيكل DiscordMap المطلوب

### الأعمدة:

| A | B | C | D |
|---|---|---|---|
| **Ingame-ID** | **Discord-Name** | **Action** | **Discord-ID** |
| DYLAN | DYLAN#1234 | | 123456789012345678 |
| Cornish | Cornish | RGR | 987654321098765432 |
| BigPapi | BigPapi | Hold | 456789123456789012 |

### شرح الأعمدة:

- **A (Ingame-ID)**: معرف اللاعب في اللعبة (Player_ID) - **مطلوب**
- **B (Discord-Name)**: اسم المستخدم في Discord - اختياري
- **C (Action)**: الأمر (RGR/OTL/RND/Hold) - اختياري
- **D (Discord-ID)**: رقم Discord ID الفريد - **مطلوب للـ mentions**

## 🎯 كيفية الحصول على Discord-ID

### الطريقة 1: من Discord Desktop/Web

1. اذهب إلى **User Settings** (⚙️)
2. اذهب إلى **Advanced**
3. فعّل **Developer Mode**
4. اضغط بزر الماوس الأيمن على أي مستخدم
5. اختر **Copy User ID**

### الطريقة 2: من البوت

استخدم أمر `/map`:
```
/map ingame_id:DYLAN discord_id:@DYLAN
```

البوت سيحفظ Discord-ID تلقائياً في العمود D.

## 🔧 التحديثات التقنية

### 1. تحديث `fetchDiscordMapping()` في `src/sheets.js`

```javascript
// قبل: قراءة A:C فقط
range: 'DiscordMap!A:C'

// بعد: قراءة A:D لتشمل Discord-ID
range: 'DiscordMap!A:D'

// إرجاع البيانات مع Discord-ID
mapping.set(playerId, { 
  discordName,  // من عمود B
  action,       // من عمود C
  discordId     // من عمود D (جديد)
});
```

### 2. تحديث `fetchPlayersDataWithDiscordNames()` في `src/sheets.js`

تم إضافة نظام أولويات لتحديد كيفية عرض الاسم:

```javascript
// Priority 1: استخدام Discord-ID من عمود D
if (discordId && /^\d+$/.test(discordId)) {
  discordName = `<@${discordId}>`;  // Mention حقيقي
}

// Priority 2: فحص إذا كان عمود B يحتوي على Discord ID
else if (discordName && /^\d+$/.test(discordName)) {
  discordName = `<@${discordName}>`;  // Mention حقيقي
}

// Priority 3: فحص إذا كان عمود B يحتوي على mention جاهز
else if (discordName && discordName.startsWith('<@')) {
  // استخدامه كما هو
}

// Priority 4: اسم مستخدم عادي
else if (discordName) {
  discordName = '@' + discordName;  // إضافة @ فقط
}
```

## 📋 أمثلة على الاستخدام

### مثال 1: Discord-ID في عمود D (الأفضل)

| Ingame-ID | Discord-Name | Action | Discord-ID |
|-----------|--------------|--------|------------|
| DYLAN | DYLAN | | 123456789012345678 |

**النتيجة**: `<@123456789012345678>` (mention حقيقي يُنبه المستخدم)

### مثال 2: Discord-ID في عمود B

| Ingame-ID | Discord-Name | Action | Discord-ID |
|-----------|--------------|--------|------------|
| DYLAN | 123456789012345678 | | |

**النتيجة**: `<@123456789012345678>` (mention حقيقي)

### مثال 3: اسم مستخدم فقط

| Ingame-ID | Discord-Name | Action | Discord-ID |
|-----------|--------------|--------|------------|
| DYLAN | DYLAN | | |

**النتيجة**: `@DYLAN` (اسم عادي، لا يُنبه المستخدم)

### مثال 4: mention جاهز في عمود B

| Ingame-ID | Discord-Name | Action | Discord-ID |
|-----------|--------------|--------|------------|
| DYLAN | <@123456789012345678> | | |

**النتيجة**: `<@123456789012345678>` (mention حقيقي)

## 🚀 كيفية ملء DiscordMap

### الطريقة 1: يدوياً

1. افتح Google Sheet
2. اذهب إلى صفحة **DiscordMap**
3. في عمود D، الصق Discord-ID لكل لاعب

### الطريقة 2: باستخدام `/map`

```bash
/map ingame_id:DYLAN discord_id:@DYLAN
/map ingame_id:Cornish discord_id:@Cornish
/map ingame_id:BigPapi discord_id:@BigPapi
```

البوت سيحفظ Discord-ID تلقائياً.

### الطريقة 3: باستخدام Script

يمكنك استخدام Google Apps Script لملء Discord-IDs تلقائياً:

```javascript
function fillDiscordIds() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('DiscordMap');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    const discordName = data[i][1]; // Column B
    // إذا كان Discord-Name يحتوي على رقم فقط، انقله إلى عمود D
    if (discordName && /^\d+$/.test(discordName)) {
      sheet.getRange(i + 1, 4).setValue(discordName); // Column D
    }
  }
}
```

## ✅ فوائد التحديث

1. **Mentions حقيقية** - اللاعبون يتلقون إشعارات عند ذكرهم
2. **ربط دقيق** - ربط مباشر بين Ingame-ID و Discord-ID
3. **سهولة التواصل** - يمكن الضغط على الـ mention للوصول للمستخدم
4. **متوافق مع الأوامر** - `/done` و `/move` تعمل مع الـ mentions
5. **مرونة** - يدعم أسماء عادية إذا لم يكن Discord-ID متوفر

## 🧪 الاختبار

### 1. اختبار مع Discord-ID

```bash
# 1. تأكد من وجود Discord-ID في عمود D
# 2. نفذ الأمر
/swap season:157

# 3. تحقق من الرسالة
# يجب أن ترى mentions حقيقية (زرقاء/قابلة للضغط)
```

### 2. اختبار بدون Discord-ID

```bash
# 1. احذف Discord-ID من عمود D
# 2. نفذ الأمر
/swap season:157

# 3. تحقق من الرسالة
# يجب أن ترى @Username (أسماء عادية)
```

### 3. اختبار `/done` مع mentions

```bash
# 1. اضغط على mention في الرسالة
# 2. انسخ الـ mention
# 3. نفذ الأمر
/done players:@Username action:add

# يجب أن يضع ✅ بجانب الاسم
```

## 📊 Logging

عند تشغيل `/swap`، ستظهر في الـ logs:

```
✅ Loaded 50 Discord name mappings
📋 Player 1: PlayerId="DYLAN", DiscordName="<@123456789>", Discord-ID="123456789", Action=""
📋 Player 2: PlayerId="Cornish", DiscordName="<@987654321>", Discord-ID="987654321", Action="RGR"
📋 Player 3: PlayerId="BigPapi", DiscordName="@BigPapi", Discord-ID="N/A", Action="Hold"
✅ Processed 50 players with Discord names (45 with mentions, 45 with Discord IDs)
```

## 🔍 استكشاف الأخطاء

### المشكلة: الأسماء تظهر عادية بدون mentions

**الحل:**
1. تحقق من وجود Discord-ID في عمود D
2. تأكد أن Discord-ID رقم صحيح (18 رقم)
3. تحقق من الـ logs - كم mention تم إنشاؤه؟

### المشكلة: Mentions لا تعمل (تظهر كنص)

**الحل:**
- Discord-ID خاطئ أو غير موجود
- تحقق من Discord-ID باستخدام Developer Mode

### المشكلة: بعض اللاعبين mentions وبعضهم لا

**الحل:**
- هذا طبيعي - فقط اللاعبون الذين لديهم Discord-ID يظهرون كـ mentions
- املأ Discord-IDs للاعبين الباقين

## 📚 الملفات المعدلة

- `src/sheets.js` - تحديث `fetchDiscordMapping()` و `fetchPlayersDataWithDiscordNames()`

## 🎉 النتيجة

الآن عند استخدام `/swap`، ستظهر أسماء اللاعبين كـ **Discord mentions** إذا كان Discord-ID موجود في DiscordMap، مما يسهل التواصل معهم ويُنبههم تلقائياً!
