export const isTransientFailure = (message: string) => /fetch failed|network error|failed to fetch|timed?\s*out|timeout|UND_ERR_|ECONNRESET|ECONNREFUSED/i.test(message);
