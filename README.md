# Head Cutout Cartoon MVP

גרסת MVP וובית שמיועדת לבדוק את הזרימה הבאה על iPad או מחשב:

1. צילום head-and-shoulders
2. חיתוך אוטומטי של ראש + שיער בלבד
3. הסרת צוואר, כתפיים, ידיים ובגדים
4. יצוא PNG שקוף
5. תצוגת preview של אפקט קומיקסי

## מה יש בפנים

- **MediaPipe Image Segmenter** עם מודל `SelfieMulticlass (256x256)`
- שמירה של קטגוריות:
  - `1 = hair`
  - `3 = face-skin`
  - אופציונלית `5 = accessories`
- אפקט cartoon/comic מבוסס Canvas
- תמיכה במצלמה וגם העלאת תמונה
- PWA בסיסי להוספה למסך הבית

## חשוב לדעת

- ה־PNG המיוצא הוא **החיתוך השקוף**, לא התמונה הקומיקסית.
- ה"קריקטורה" כאן היא כרגע אפקט קומיקסי מהיר. אם תרצה אחר כך מודל AI קריקטורי אמיתי, נחליף את שלב ה־Canvas במודל ייעודי.
- בשביל iPad Safari בחרתי `delegate: 'CPU'` לשלב ה־segmentation כדי לצמצם בעיות תאימות מוכרות עם GPU על iOS.

## איך להריץ מקומית

### אפשרות 1 — Python

```bash
cd head-cutout-webapp
python3 -m http.server 8080
```

ואז לפתוח:

```text
http://localhost:8080
```

### אפשרות 2 — VS Code Live Server

אפשר לפתוח את התיקייה ולהריץ Live Server.

## איך לבדוק על iPad

### הכי פשוט

- להעלות את התיקייה ל־Netlify / Vercel / GitHub Pages
- לפתוח את הקישור ב־Safari באייפד
- לאשר גישה למצלמה

### דרך הרשת המקומית

- להריץ את השרת על המחשב
- לוודא שהמחשב והאייפד על אותה רשת Wi‑Fi
- לפתוח באייפד:

```text
http://<LOCAL-IP-OF-YOUR-COMPUTER>:8080
```

## קבצים עיקריים

- `index.html` — ממשק
- `styles.css` — עיצוב
- `app.js` — צילום, segmentation, חיתוך ו־export
- `sw.js` — service worker בסיסי
- `manifest.webmanifest` — PWA בסיסי

## הצעד הבא המומלץ

אחרי שתוודא שהחיתוך עובד טוב על התמונות שלך, השלב הבא הוא:

- להוסיף **מודל AI לקריקטורה אמיתית**
- או לחבר את ה־PNG החתוך ישירות לאפליקציה השנייה שלך
