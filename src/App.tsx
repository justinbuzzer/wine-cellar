import type { ReactNode } from "react";
import type { AccountInfo } from "@azure/msal-browser";
import { isAllowed, signIn, signOut } from "./auth";
import { config } from "./config";
import { href, useRoute } from "./router";
import { useWorkbook, WorkbookGate } from "./store";
import { BackToTop, InstallButton, ThemeToggle, ToastProvider } from "./ui";
import Cellar from "./views/Cellar";
import Diagnostics from "./views/Diagnostics";
import WineDetail from "./views/WineDetail";
import WineForm from "./views/WineForm";
import WineList from "./views/WineList";
import PurchaseForm from "./views/PurchaseForm";
import NoteForm from "./views/NoteForm";
import NoteView from "./views/NoteView";
import Notes from "./views/Notes";
import Overview from "./views/Overview";
import History from "./views/History";
import Producers from "./views/Producers";
import Sales from "./views/Sales";
import { LogoProvider } from "./logos";

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
  { path: "list", label: "Wine list" },
  { path: "notes", label: "Notes" },
  { path: "overview", label: "Overview" },
];

function Shell({ account, tabs, children }: { account?: AccountInfo; tabs?: boolean; children: ReactNode }) {
  const route = useRoute();
  const section =
    route[0] === "wine" || route[0] === "add" || route[0] === "edit" || route[0] === "purchase" || !route[0]
      ? "cellar"
      : route[0] === "note"
        ? "notes"
        : route[0] === "history" || route[0] === "producers" || route[0] === "sales"
          ? "overview"
          : route[0];
  const page = route[0] ?? "cellar";
  const isListPage = page === "cellar" || page === "list" || page === "notes" || page === "overview" || page === "history" || page === "producers" || page === "sales";
  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <a href={href("cellar")}>Wine Cellar</a>
        </h1>
        <div className="topbar-right">
          <ThemeToggle />
          {account && (
            <div className="who">
              <span>{account.name}</span>
              <button className="link" onClick={() => signOut()}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      {tabs && (
        <nav className="tabs">
          {TABS.map((t) => (
            <a
              key={t.path}
              href={href(t.path)}
              className={section === t.path ? "on" : ""}
              onClick={(e) => {
                // Tapping the tab you're already on goes back to the top.
                if (page === t.path) {
                  e.preventDefault();
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
            >
              {t.label}
            </a>
          ))}
        </nav>
      )}
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
    if (arg && sub === "edit") return <NoteForm key={`edit-${arg}`} editId={arg} />;
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
      return <PurchaseForm />;
    case "edit":
      return <WineForm key={`edit-${arg}`} id={arg} />;
    case "list":
      return <WineList />;
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
    default:
      return <Cellar />;
  }
}
