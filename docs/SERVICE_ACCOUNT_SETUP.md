# Service-account setup for Google (GA4 + Search Console)

This makes Beacon read your Google Analytics and Search Console data with a
service account instead of your personal Google login. A service account never
expires, so the "Reconnect Google" prompts every few days stop for good.

Do these three steps once. It takes about ten minutes.

## 1. Create the service account and its key

1. Open the Google Cloud Console, pick the project that owns your Google login.
2. Go to IAM and admin, then Service Accounts, then Create service account.
3. Give it a name like "beacon-reader". Skip the optional role step, click Done.
4. Open the new account, go to the Keys tab, Add key, Create new key, choose
   JSON, and download the file. Keep it safe; you cannot download it again.
5. From that JSON file you need two values: `client_email` and `private_key`.

## 2. Give the service account read access to your data

1. In Search Console, open Settings, then Users and permissions, then Add user.
   Paste the `client_email` from step 1 and set permission to Full. Save.
2. In Google Analytics, open Admin, then Property access management, then the
   plus button. Paste the same `client_email`, choose the Viewer role, and
   uncheck "Notify by email". Save.

## 3. Set the two environment variables

Set these wherever Beacon runs. For the private key, paste the whole value
including the BEGIN and END lines; if your host needs it on one line, the literal
`\n` sequences are handled automatically.

1. `GOOGLE_SERVICE_ACCOUNT_EMAIL` = the `client_email` value.
2. `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` = the `private_key` value.

Set them in Vercel (Project, Settings, Environment Variables) and in your local
`.env.local`. Redeploy. That is it. When both are present Beacon uses the service
account first and falls back to your old login only if the service account fails.
