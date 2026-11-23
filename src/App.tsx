import type { ReactNode } from "react";
import type { AccountInfo } from "@azure/msal-browser";
import { isAllowed, signIn, signOut } from "./auth";
import { config } from "./config";
import { href, useRoute } from "./router";
import { useWorkbook, WorkbookGate } from "./store";
import { BackToTop, InstallButton, ToastProvider } from "./ui";
import Cellar from "./views/Cellar";
import Diagnostics from "./views/Diagnostics";
import WineDetail from "./views/WineDetail";
import WineForm from "./views/WineForm";
import SaleLists from "./views/SaleLists";
import WineList from "./views/WineList";
import PurchaseForm from "./views/PurchaseForm";
import SellForm from "./views/SellForm";
import NoteForm from "./views/NoteForm";
import NoteView from "./views/NoteView";
import NoteCompare from "./views/NoteCompare";
import Notes from "./views/Notes";
import Overview from "./views/Overview";
import History from "./views/History";
import Producers from "./views/Producers";
import Research from "./views/Research";
import Sales from "./views/Sales";
import Stocktake from "./views/Stocktake";
import Settings from "./views/Settings";
import Storage from "./views/Storage";
import GroupBuys from "./views/GroupBuys";
import { LogoProvider } from "./logos";
import { BRAND, BrandLogo } from "./brand";

export default function App({ account }: { account: AccountInfo | null }) {
  if (!account) {
    return (
      <Shell>
        <section className="card center">
          <p>Sign in with your Microsoft account to open your wine cellar.</p>
          <button className="primary" onClick={() => signIn()}>Sign in with Microsoft</button>
        </section>
      </Shell>
    );
  }
  if (!isAllowed(account)) {
    return (
      <Shell account={account}>
        <section className="card center">
          <p>This account isn't authorised to use this app.</p>
        </section>
      </Shell>
    );
  }
  return (
    <ToastProvider>
      <Shell account={account} tabs>
        <WorkbookGate>
          <LogoProvider>
            <TestBanner />
            <Routes />
          </LogoProvider>
        </WorkbookGate>
      </Shell>
    </ToastProvider>
  );
}

const TABS = [
  { path: "cellar", label: "Cellar" },
  { path: "notes", label: "Notes" },
  { path: "overview", label: "Overview" },
  { path: "list", label: "Wine list" },
  { path: "groupbuys", label: "Group Buys" },
  { path: "settings", label: "Settings" },
];

/** Simple line icons for the tab dock (drawn here so they look the same on every phone). */
function TabIcon({ path }: { path: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
      {path === "cellar" && (
        <g {...p}>
          <path d="M10 2.5h4M10.5 2.5v4.2c0 .6-.3 1.1-.7 1.5L8.6 9.6c-.4.4-.6.9-.6 1.5V20a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5v-8.9c0-.6-.2-1.1-.6-1.5l-1.2-1.4c-.4-.4-.7-.9-.7-1.5V2.5" />
          <path d="M8 13.5h8v4H8z" />
        </g>
      )}
      {path === "notes" && (
        <g {...p}>
          <path d="M6 3.5h9l3 3v14H6z" />
          <path d="M9 10h6M9 13.5h6M9 17h4" />
        </g>
      )}
      {path === "overview" && (
        <g {...p}>
          <path d="M4 20.5h16" />
          <path d="M6.5 17v-5M11 17V7M15.5 17v-7.5M20 17V4.5" />
        </g>
      )}
      {path === "list" && (
        <g {...p}>
          <path d="M9 6.5h11M9 12h11M9 17.5h11" />
          <circle cx="5" cy="6.5" r=".9" />
          <circle cx="5" cy="12" r=".9" />
          <circle cx="5" cy="17.5" r=".9" />
        </g>
      )}
      {path === "settings" && (
        <g {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </g>
      )}
      {path === "groupbuys" && (
        <g {...p}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20c.4-3.4 2.9-5.5 6-5.5s5.6 2.1 6 5.5" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M16.2 14.6c2.7.1 4.4 1.9 4.8 5.4" />
        </g>
      )}
    </svg>
  );
}

function Shell({ account, tabs, children }: { account?: AccountInfo; tabs?: boolean; children: ReactNode }) {
  const route = useRoute();
  const section =
    route[0] === "wine" || route[0] === "add" || route[0] === "edit" || route[0] === "purchase" || route[0] === "sell" || route[0] === "stocktake" || route[0] === "storage" || !route[0]
      ? "cellar"
      : route[0] === "note"
        ? "notes"
        : route[0] === "history" || route[0] === "producers" || route[0] === "sales"
          ? "overview"
          : route[0] === "forsale"
            ? "list"
            : route[0];
  const page = route[0] ?? "cellar";
  const isListPage = page === "cellar" || page === "list" || page === "notes" || page === "overview" || page === "history" || page === "producers" || page === "sales" || page === "groupbuys";
  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <a href={href("cellar")} aria-label={BRAND}>
            <BrandLogo />
          </a>
        </h1>
        {/* On a computer the dock sits here, between the logo and the buttons; on a phone it floats at the bottom. */}
        {tabs && (
          <nav className="tabs dock" aria-label="Sections">
            {TABS.map((t) => (
              <a
                key={t.path}
                href={href(t.path)}
                className={`${section === t.path ? "on" : ""}${t.path === "settings" ? " dock-settings" : ""}`}
                title={t.label}
                aria-label={t.label}
                onClick={(e) => {
                  // Tapping the tab you're already on goes back to the top.
                  if (page === t.path) {
                    e.preventDefault();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }
                }}
              >
                <TabIcon path={t.path} />
                <span>{t.label}</span>
              </a>
            ))}
          </nav>
        )}
        <div className="topbar-right">
          {account && (
            <div className="who">
              <span>{account.name}</span>
              <button className="link" onClick={() => signOut()}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <main>{children}</main>
      {tabs && isListPage && <BackToTop />}
      {account && (
        <footer className="foot">
          <a href={href("diagnostics")}>Diagnostics</a> <InstallButton />
        </footer>
      )}
    </div>
  );
}

function TestBanner() {
  const { data } = useWorkbook();
  const isTest = /test/i.test(data.file.name);
  if (config.usingTestFile && !isTest) {
    return <div className="banner real">Development mode is using a file that isn't the TEST copy: {data.file.name}</div>;
  }
  if (isTest) return <div className="banner test">TEST copy: {data.file.name}</div>;
  return null;
}

function Routes() {
  const [page, arg, sub, subArg] = useRoute();
  if (page === "note") {
    if (arg === "new") {
      if (sub === "wine") return <NoteForm key={`new-w-${subArg}`} wineId={subArg} />;
      if (sub === "from") return <NoteForm key={`new-t-${subArg}`} fromId={subArg} />;
      return <NoteForm key="new" />;
    }
    if (arg === "draft" && sub) return <NoteForm key={`draft-${sub}`} draftId={sub} />;
    if (arg && sub === "edit") return <NoteForm key={`edit-${arg}`} editId={arg} />;
    if (arg && sub === "compare") return <NoteCompare key={`cmp-${arg}`} id={arg} />;
    if (arg) return <NoteView key={arg} id={arg} />;
  }
  switch (page) {
    case undefined:
    case "cellar":
      return <Cellar />;
    case "wine":
      return <WineDetail key={arg} id={arg} />;
    case "add":
      return <WineForm key="add" />;
    case "purchase":
      return <PurchaseForm key={arg ?? "purchase"} startGroup={arg === "group"} />;
    case "groupbuys":
      return <GroupBuys key={`${arg ?? ""}-${sub ?? ""}`} view={arg} arg={sub} />;
    case "sell":
      return <SellForm key={arg ?? "sell"} preselect={arg} />;
    case "stocktake":
      return <Stocktake key={`${arg ?? ""}-${sub ?? ""}-${subArg ?? ""}`} step={arg} arg={sub} spot={subArg} />;
    case "settings":
      return <Settings />;
    case "storage":
      return <Storage key={`${arg ?? ""}-${sub ?? ""}`} loc={arg} spot={sub} />;
    case "edit":
      return <WineForm key={`edit-${arg}`} id={arg} />;
    case "list":
      return <WineList />;
    case "forsale":
      return <SaleLists key={`${arg ?? ""}-${sub ?? ""}-${subArg ?? ""}`} arg={arg} sub={sub} subArg={subArg} />;
    case "notes":
      return <Notes />;
    case "overview":
      return <Overview />;
    case "history":
      return <History key={arg ?? "all"} month={arg} />;
    case "producers":
      return <Producers />;
    case "sales":
      return <Sales key={arg ?? "all"} period={arg} />;
    case "diagnostics":
      return <Diagnostics />;
    case "research":
      return <Research />;
    default:
      return <Cellar />;
  }
}
