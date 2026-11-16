import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initAuth } from "./auth";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

initAuth()
  .then((account) => {
    root.render(
      <StrictMode>
        <App account={account} />
      </StrictMode>,
    );
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    root.render(
      <div className="app">
        <main>
          <section className="card error">
            <h2>Sign-in failed</h2>
            <p>{message}</p>
            <button className="primary" onClick={() => window.location.assign(import.meta.env.BASE_URL)}>
              Start again
            </button>
          </section>
        </main>
      </div>,
    );
  });
