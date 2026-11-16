import type { ReactNode } from "react";
import type { AccountInfo } from "@azure/msal-browser";
import { isAllowed, signIn, signOut } from "./auth";
import { config } from "./config";
import { href, useRoute } from "./router";
import { useWorkbook, WorkbookGate } from "./store";
import { ToastProvider } from "./ui";
import Cellar from "./views/Cellar";
import Diagnostics from "./views/Diagnostics";
import WineDetail from "./views/WineDetail";
import WineForm from "./views/WineForm";

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
          <TestBanner />
          <Routes />
        </WorkbookGate>
      </Shell>
    </ToastProvider>
  );
}

const TABS = [
  { path: "cellar", label: "Cellar" },
  { path: "list", label: "Wine list" },
  { path: "notes", label: "Notes" },
];

function Shell({ account, tabs, children }: { account?: AccountInfo; tabs?: boolean; children: ReactNode }) {
  const route = useRoute();
  const section = route[0] === "wine" || route[0] === "add" || route[0] === "edit" || !route[0] ? "cellar" : route[0];
  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <a href={href("cellar")}>Wine Cellar</a>
        </h1>
        {account && (
          <div className="who">
            <span>{account.name}</span>
            <button className="link" onClick={() => signOut()}>Sign out</button>
          </div>
        )}
      </header>
      {tabs && (
        <nav className="tabs">
          {TABS.map((t) => (
            <a key={t.path} href={href(t.path)} className={section === t.path ? "on" : ""}>
              {t.label}
            </a>
          ))}
        </nav>
      )}
      <main>{children}</main>
      {account && (
        <footer className="foot">
          <a href={href("diagnostics")}>Diagnostics</a>
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
  const [page, arg] = useRoute();
  switch (page) {
    case undefined:
    case "cellar":
      return <Cellar />;
    case "wine":
      return <WineDetail key={arg} id={arg} />;
    case "add":
      return <WineForm key="add" />;
    case "edit":
      return <WineForm key={`edit-${arg}`} id={arg} />;
    case "list":
      return <ComingSoon title="Wine list" step="step 3" text="A restaurant-style list of your cellar, grouped by type and region, printable to PDF." />;
    case "notes":
      return <ComingSoon title="Tasting notes" step="steps 4–5" text="Quick note entry with your WSET scales, and search across all your past notes." />;
    case "diagnostics":
      return <Diagnostics />;
    default:
      return <Cellar />;
  }
}

function ComingSoon({ title, step, text }: { title: string; step: string; text: string }) {
  return (
    <section className="card center">
      <h2>{title}</h2>
      <p className="muted">Coming in {step}.</p>
      <p>{text}</p>
    </section>
  );
}
