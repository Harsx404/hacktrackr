import axios from 'axios';

/**
 * Shared axios instance with a browser-like User-Agent to avoid bot blocking.
 * Timeout is set conservatively at 15s.
 */
export const httpClient = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  },
});
