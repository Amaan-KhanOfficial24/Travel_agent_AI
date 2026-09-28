# Setup: run the app with the real Duffel and Gemini test APIs

Everything runs in GitHub Codespaces. You only need a browser (or VS Code) and two free keys.
Nothing here can buy a real ticket: Duffel test mode books against its test airline and takes no money.

## 1. Get a Duffel test token (flights)

1. Sign up at <https://app.duffel.com> (free, no card).
2. Make sure the dashboard is in **Test mode** (toggle at the top).
3. **Developers → Access tokens → Create token**. Copy it. It starts with `duffel_test_`.

## 2. Get a Gemini API key (AI assistant)

1. Go to <https://aistudio.google.com> and sign in with a Google account.
2. **Get API key → Create API key**. Copy it.

The app works without this key; only the Assistant page needs it.

## 3. Save both keys as Codespaces secrets

1. Open <https://github.com/settings/codespaces>.
2. **New secret**: name `DUFFEL_ACCESS_TOKEN`, paste the Duffel token, and under *Repository access* pick **Travel_agent_AI**. Save.
3. **New secret**: name `GEMINI_API_KEY`, paste the Gemini key, same repository. Save.

The keys never go into the code or into Git. (If you create the Codespace first, it also asks for them.)

## 4. Start the Codespace

On the repository page: **Code → Codespaces → Create codespace on main**.
The first start takes a few minutes: it installs everything and starts the database.

If a Codespace was already open before you added the secrets, stop and restart it so it picks them up.

## 5. Check and run

In the Codespace terminal:

```bash
npm run check   # tests your keys against the real APIs; should show all ✅
npm run dev     # starts the API and the web app
```

The app opens in a new browser tab (port 5173). If it doesn't, open the **Ports** tab and click the globe next to 5173.

## 6. Try it

- **Assistant**: "Flights from DXB to LHR on 2026-12-15 for 2 adults, nonstop".
- **Trips**: create a trip, add all passengers, then **Search flights for this trip**.
- **Duffel's test scenarios** (use these routes to see the recovery features with the real test API):

| Route | What happens |
| --- | --- |
| LHR → STN | Price changes when you check it: you see the old price, the new price and the difference |
| LGW → LHR | Fare is no longer available: alternatives are offered |
| LHR → LGW | The airline rejects the order: booking goes to "Being checked by our team" |
| LTN → STN | Airline accepts the order but confirms later: press **Check status** |
| PVD → RAI | No flights found |
| any other route | Normal search and booking with "Duffel Airways" |

Use an international phone number format when booking, e.g. `+971501234567`.

## Offline mode (no keys at all)

`npm run dev:offline` runs the app against built-in stand-ins for Duffel and Gemini with the same scenarios,
plus `LHR → GLA` (price rises while booking, asks for your approval) and `LHR → MAN` (rise above the 25% limit).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `npm run check` says a key is missing | The secret isn't visible to this Codespace: check *Repository access* on the secret, then restart the Codespace |
| "Flight search is not set up yet" in the app | Same as above |
| "Model … was not found" | In <https://github.com/settings/codespaces>, add a secret `GEMINI_MODEL` with a model name shown in AI Studio |
| "free usage limit" from the assistant | Gemini's free tier is per minute and per day; wait and try again |
| Database not reachable | `docker compose up -d db` |
| Settings you can change | See `apps/api/.env.example` (e.g. `BOOKING_MAX_INCREASE_PCT`, `BOOKING_MAX_ATTEMPTS`) |
