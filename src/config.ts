// App configuration. Nothing in this file is secret: the client ID is a public
// identifier, and all data access requires signing in with your Microsoft account.

export const config = {
  /** Microsoft Entra "Wine Cellar" app registration (Application / client ID). */
  clientId: "3e0a3684-b3f0-4815-975c-d36870055283",

  /** Personal Microsoft accounts only. */
  authority: "https://login.microsoftonline.com/consumers",

  /** Works for both http://localhost:5173/wine-cellar/ and https://justinbuzzer.github.io/wine-cellar/ */
  redirectUri: `${window.location.origin}${import.meta.env.BASE_URL}`,

  /** Files.ReadWrite is requested now so later steps don't need a new consent prompt. */
  scopes: ["User.Read", "Files.ReadWrite"],

  /** Where to look for the workbook the first time (path inside your OneDrive). */
  defaultWorkbookPath: "/Documents/Wine Knowledge Bank v3.xlsx",

  /** Used if the file isn't at the default path. */
  workbookSearchText: "Wine Knowledge Bank",

  tables: {
    inventory: "Inventory",
    tastings: "Tasted",
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
   * The app shows your account ID at the bottom of the page if you want to lock it down.
   */
  allowedAccountIds: [] as string[],

  currency: "SGD",
} as const;
