# Head Caricature Studio v4 — Local AI

זאת הגרסה שמחברת בין:
- **Frontend וובי** שעובד על iPad / Safari / GitHub Pages
- **Backend מקומי על Windows** שמריץ 2 קריקטורות AI שונות על המחשב שלך

## מה יש בפרויקט

### frontend
- `index.html`
- `app.js`
- `styles.css`
- `manifest.webmanifest`
- `sw.js`

### backend
- `main.py` — API מקומי ב-FastAPI
- `requirements.txt`
- `start_server.bat` — הפעלה מהירה
- `check_cuda.py` — בדיקת GPU

## הזרימה
1. צילום או העלאת תמונה
2. חיתוך אוטומטי של ראש + שיער בדפדפן
3. שליחה לשרת המקומי
4. קבלת 2 קריקטורות AI:
   - `soft`
   - `bold`
5. בחירה וייצוא PNG

## ברירת מחדל של שרת
ה-frontend מנסה לעבוד מול:

`http://127.0.0.1:7861`

אפשר לשנות את הכתובת ממסך ההתחלה תחת **הגדרות שרת AI**.

## הרצה מקומית של האתר

מתוך תיקיית הפרויקט הראשית:

```bash
python -m http.server 8080
```

ואז פתח:

`http://127.0.0.1:8080`

## הפעלה מה-iPad
מה-iPad צריך:
1. שהאתר יהיה זמין דרך GitHub Pages או שרת סטטי אחר
2. שה-backend המקומי שלך יהיה חשוף דרך tunnel חיצוני
3. להכניס את כתובת ה-tunnel למסך **הגדרות שרת AI**

## הערה חשובה
בפעם הראשונה שה-backend ירוץ, הספרייה `diffusers` תוריד את מודל ה-AI למחשב שלך. זה יכול לקחת זמן ונפח דיסק.

## המלצה
התחל קודם ב-PC המקומי:
- פתח את האתר מהמחשב
- פתח את ה-backend
- בדוק שהחיבור עובד
- רק אחר כך פתח tunnel ובדוק מה-iPad
