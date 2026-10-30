# تطبيق الأندرويد (APK)

نافذة كاملة على موقع النظام (Trusted Web Activity). كل ما يظهر فيه يأتي من الموقع، فتحديثات الموقع تصل للتطبيق وحدها؛ لا يُعاد بناء هذا التطبيق إلا إذا تغيّر عنوان الموقع (`siteUrl` في `app/build.gradle`).

- يُحمَّل من: `https://mukhayyam2.pages.dev/mukhayyam2.apk`
- ليفتح بلا شريط عنوان، يحتاج الموقع الملف `/.well-known/assetlinks.json` (في `app/public/`) ببصمة مفتاح التوقيع.
- مفتاح التوقيع **ليس** في المستودع. احفظ ملف `mukhayyam2.keystore` وكلمة سره عندك: بدونهما لا يمكن إصدار تحديث يُثبَّت فوق النسخة الحالية.

البناء (يحتاج Android SDK وJava 17+):

```bash
M2_KEYSTORE=/path/mukhayyam2.keystore M2_KEYSTORE_PASSWORD=... ANDROID_HOME=/path/android-sdk gradle -p android assembleRelease
```

الناتج: `android/app/build/outputs/apk/release/app-release.apk`
