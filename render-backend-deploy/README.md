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
BREVO_API_KEY=your-brevo-transactional-email-api-key
SMTP_FROM=House of Kamala <kamalahouseofsaree@gmail.com>
EMAIL_FROM_NAME=House of Kamala
```

Do not commit real passwords to GitHub. Add `MONGODB_URI`, `BREVO_API_KEY`, and payment gateway secrets in Render's Environment tab.

Gmail SMTP can time out on some hosting networks. The app uses Brevo's HTTPS email API when `BREVO_API_KEY` is configured.
