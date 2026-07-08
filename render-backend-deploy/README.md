# House of Kamala Backend

Render settings:

- Service type: Web Service
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`

Environment variables:

```text
MONGODB_URI=mongodb+srv://hemagd10_db_user:YOUR_PASSWORD@cluster0.qz6jngo.mongodb.net/shopdb?appName=Cluster0
CORS_ORIGIN=https://houseofkamala.com,https://www.houseofkamala.com
PUBLIC_API_URL=https://api.houseofkamala.com
SMTP_HOST=smtp.your-email-provider.com
SMTP_PORT=587
SMTP_USER=your-sender-email@example.com
SMTP_PASS=your-email-app-password
SMTP_FROM="House of Kamala <your-sender-email@example.com>"
```

Do not commit real passwords to GitHub. Add `MONGODB_URI`, `SMTP_PASS`, and payment gateway secrets in Render's Environment tab.
