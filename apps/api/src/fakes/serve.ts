// `npm run fakes`: run the stand-in Duffel (port 4010) and Gemini (port 4020) servers,
// for offline demos and browser tests. Point the API at them with
//   DUFFEL_BASE_URL=http://localhost:4010 DUFFEL_ACCESS_TOKEN=duffel_test_fake
//   GEMINI_BASE_URL=http://localhost:4020 GEMINI_API_KEY=fake
import { createFakeDuffel } from './fakeDuffel.js';
import { createFakeGemini } from './fakeGemini.js';

const duffelPort = Number(process.env.FAKE_DUFFEL_PORT ?? 4010);
const geminiPort = Number(process.env.FAKE_GEMINI_PORT ?? 4020);
createFakeDuffel().listen(duffelPort, () => console.log(`Fake Duffel on http://localhost:${duffelPort}`));
createFakeGemini().listen(geminiPort, () => console.log(`Fake Gemini on http://localhost:${geminiPort}`));
