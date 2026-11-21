// App configuration. Nothing in this file is secret: the client ID is a public
// identifier, and all data access requires signing in with your Microsoft account.

const isDev = import.meta.env.DEV;

export const config = {
  /** Microsoft Entra "Wine Cellar" app registration (Application / client ID). */
  clientId: "3e0a3684-b3f0-4815-975c-d36870055283",

  /** Personal Microsoft accounts only. */
  authority: "https://login.microsoftonline.com/consumers",

  /** Works for both http://localhost:5173/wine-cellar/ and https://justinbuzzer.github.io/wine-cellar/ */
  redirectUri: `${window.location.origin}${import.meta.env.BASE_URL}`,

  /** Files.ReadWrite is needed to update the workbook. */
  scopes: ["User.Read", "Files.ReadWrite"],

  /**
   * Local development (npm run dev) always uses the TEST copy; the published site
   * uses the real workbook. Paths are inside your OneDrive.
   */
  usingTestFile: isDev,
  defaultWorkbookPath: isDev
    ? "/Documents/Wine Knowledge Bank v3 TEST.xlsx"
    : "/Documents/Wine Knowledge Bank v3.xlsx",

  /** Producer logos, one picture per producer, named after the producer (e.g. "Torbreck.png"). */
  logoFolder: isDev ? "/Documents/Wine Cellar Logos TEST" : "/Documents/Wine Cellar Logos",

  /** Remembered file ID is stored separately for dev and the live site. */
  storageKey: `wine-cellar.workbookItemId.${import.meta.env.MODE}`,

  /** Used if the file isn't at the default path. */
  workbookSearchText: "Wine Knowledge Bank",

  tables: {
    inventory: "Inventory",
    tastings: "Tasted",
    /** Bottle history. Created automatically (on a new "Opened" sheet) the first time you open a bottle. */
    history: "Opened",
    /** Bottles sold. Created automatically (on a new "Sold" sheet) the first time you sell a bottle. */
    sales: "Sold",
    /** Unfinished tasting notes. Created automatically (on a new "Drafts" sheet) the first time you save a draft. */
    drafts: "Drafts",
  },

  lists: [
    "List_Finish",
    "List_Acid",
    "List_Tannin",
    "List_Body",
    "List_Intensity",
    "List_Blend",
    "List_Type",
    "List_Dryness",
    "List_Status",
  ],

  /**
   * Optional: Microsoft account IDs allowed to use the app. Empty = any signed-in
   * account (each person can only ever see their own OneDrive anyway).
   */
  allowedAccountIds: [] as string[],

  currency: "SGD",

  /**
   * "Fill from label" on tasting notes: the Cloudflare Worker in /worker that holds
   * the Claude API key. Empty = the button is hidden. Not a secret; it only answers
   * your own Microsoft sign-in.
   */
  labelReaderUrl: "https://wine-label-reader.wine-label-reader.workers.dev" as string,
} as const;
