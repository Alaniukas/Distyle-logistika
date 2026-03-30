Logistikos platforma — gamintojų ir vežėjų automatizacija

Greita schema
1) Į `GRAPH_MAILBOX_USER` ateina gamintojų laiškai su priedais (PDF/Excel/Word).
2) `POST /api/internal/sync-mail` importuoja laiškus, taiko whitelist (`ALLOWED_SENDERS`) ir sukuria užsakymą.
3) Vartotojas atsidaro užsakymą, pakoreguoja šabloną ir paspaudžia „Siųsti vežėjams“.
4) Vežėjų reply importuojami per `POST /api/internal/sync-offers`.
5) Pasiūlymai parodomi lentelėje; galima siųsti patvirtinimą pasirinktam vežėjui.

Svarbiausi ENV
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `GRAPH_MAILBOX_USER`
- `DATABASE_URL`
- `SYNC_SECRET` (rankiniai POST į /api/internal/*)
- `CRON_SECRET` (Vercel Cron — dažnai tas pats kaip SYNC_SECRET)
- `ALLOWED_SENDERS` (kableliais) arba DB AllowedSender
- `MAIL_SUBJECT_FILTER` (tuščia = be filtro)
- `CARRIER_ORDERS_TO_EMAIL` (nebūtina; numatytai orders@digroup.lt)
- `GOOGLE_GENERATIVE_AI_API_KEY` (rekomenduojama pilnam parsinimui)

Lokalus paleidimas
- `npm install`
- `npx prisma db push`
- `npm run dev`

Rankiniai testai
- Mail test:
  `POST /api/internal/mail-test` su `Authorization: Bearer <SYNC_SECRET>`
- Užsakymų importas:
  `POST /api/internal/sync-mail`
- Vežėjų pasiūlymų importas:
  `POST /api/internal/sync-offers`

Vercel (žr. vercel.json)
- GET `/api/cron/sync-mail` ir `/api/cron/sync-offers` kas 10 min.
- Projekte nustatykite `CRON_SECRET` (Vercel prideda Authorization: Bearer).
- Serveris priima `Bearer CRON_SECRET` arba `Bearer SYNC_SECRET`.
