// Where the e2e run's own servers listen. Deliberately not 8000/4173, which a
// developer's own backend and preview use: the suite starts its own pair and never
// reuses whatever happens to be running there (that sent test traffic to dev.db).
export const E2E_API_PORT = 8001
export const E2E_WEB_PORT = 4174
export const E2E_API_URL = `http://localhost:${E2E_API_PORT}`
export const E2E_WEB_URL = `http://localhost:${E2E_WEB_PORT}`
