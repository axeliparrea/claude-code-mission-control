/**
 * Minimal web viewer — fetches URLs and converts HTML to terminal-friendly text.
 * No external dependencies — uses Node.js built-in fetch + simple HTML stripping.
 * @module web-viewer
 */

import { fg, icons } from './theme.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const UNDERLINE = '\x1b[4m';

/**
 * Manages web content fetching and text rendering.
 */
export interface WebViewer {
  /**
   * Fetches a URL and returns formatted text lines.
   */
  fetch(url: string): Promise<void>;

  /**
   * Returns the currently rendered lines.
   */
  getLines(): string[];

  /**
   * Returns the current URL being viewed.
   */
  readonly currentUrl: string;

  /**
   * Returns loading state.
   */
  readonly loading: boolean;

  /**
   * Returns history of visited URLs.
   */
  readonly history: string[];
}

/**
 * Strips HTML tags and converts common elements to terminal-friendly text.
 */
function htmlToText(html: string): string[] {
  let text = html;

  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, `\n${BOLD}$1${RESET}\n`);
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, `\n${BOLD}$1${RESET}\n`);
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, `\n${BOLD}$1${RESET}\n`);
  text = text.replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gi, `\n$1\n`);

  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, `${UNDERLINE}$2${RESET} ${DIM}($1)${RESET}`);

  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '  - $1\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/tr>/gi, '\n');

  text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, `${fg.mcp}$1${RESET}`);
  text = text.replace(/<pre[^>]*>(.*?)<\/pre>/gis, `\n${fg.textDim}$1${RESET}\n`);
  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, `${BOLD}$1${RESET}`);
  text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, `${BOLD}$1${RESET}`);
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, `$1`);

  text = text.replace(/<[^>]+>/g, '');

  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');

  const lines = text.split('\n')
    .map((l) => l.trim())
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''));

  return lines;
}

/**
 * Creates a new WebViewer instance.
 */
export function createWebViewer(): WebViewer {
  let lines: string[] = [`${DIM}  Type a URL to browse${RESET}`, `${DIM}  Example: https://docs.anthropic.com${RESET}`];
  let currentUrl = '';
  let loading = false;
  const urlHistory: string[] = [];

  return {
    async fetch(url: string): Promise<void> {
      let normalizedUrl = url.trim();
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = 'https://' + normalizedUrl;
      }

      currentUrl = normalizedUrl;
      loading = true;
      lines = [`${fg.thinking}${icons.pending} Loading ${normalizedUrl}...${RESET}`];

      try {
        const response = await globalThis.fetch(normalizedUrl, {
          headers: { 'User-Agent': 'Claude-Mission-Control/0.1' },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          lines = [
            `${fg.error}${icons.error} HTTP ${response.status} ${response.statusText}${RESET}`,
            `${DIM}  URL: ${normalizedUrl}${RESET}`,
          ];
          loading = false;
          return;
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
          lines = [
            `${fg.thinking}${icons.arrow} ${contentType}${RESET}`,
            `${DIM}  Content type not supported for text rendering${RESET}`,
            `${DIM}  URL: ${normalizedUrl}${RESET}`,
          ];
          loading = false;
          return;
        }

        const html = await response.text();
        const titleMatch = /<title[^>]*>(.*?)<\/title>/i.exec(html);
        const title = titleMatch?.[1]?.trim() ?? normalizedUrl;

        const textLines = htmlToText(html);
        lines = [
          `${BOLD}${fg.main}${title}${RESET}`,
          `${DIM}${normalizedUrl}${RESET}`,
          '',
          ...textLines,
        ];

        urlHistory.push(normalizedUrl);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        lines = [
          `${fg.error}${icons.error} Failed to fetch${RESET}`,
          `${DIM}  ${errMsg}${RESET}`,
          `${DIM}  URL: ${normalizedUrl}${RESET}`,
        ];
      }

      loading = false;
    },

    getLines(): string[] {
      return lines;
    },

    get currentUrl(): string {
      return currentUrl;
    },

    get loading(): boolean {
      return loading;
    },

    get history(): string[] {
      return [...urlHistory];
    },
  };
}
