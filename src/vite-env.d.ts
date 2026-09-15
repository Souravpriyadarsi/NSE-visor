interface ImportMetaEnv {
  /** Cloudflare Worker URL (see worker/) that relays Yahoo Finance requests for the hosted site. */
  readonly VITE_YAHOO_PROXY_URL?: string;
  /** Where the hosted site gets Angel One data (not set up yet; locally the dev server provides it). */
  readonly VITE_ANGEL_URL?: string;
}
