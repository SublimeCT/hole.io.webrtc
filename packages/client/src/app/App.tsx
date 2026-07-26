import { lazy, Suspense } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { HomePage } from "../pages/HomePage";
import { OnlineRoomPage } from "../pages/OnlineRoomPage";
import { ResultsPage } from "../pages/ResultsPage";
import { MultiplayerProvider } from "../net/MultiplayerProvider";
import { VoidWordmark } from "../ui/VoidWordmark";
import { translate } from "./i18n";
import { loadPreferences } from "./preferences";

const GamePage = lazy(() => import("../pages/GamePage"));

export function App() {
  return (
    <HashRouter>
      <MultiplayerProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/online" element={<OnlineRoomPage />} />
          <Route
            path="/game"
            element={
              <Suspense fallback={<RouteLoading />}>
                <GamePage />
              </Suspense>
            }
          />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MultiplayerProvider>
    </HashRouter>
  );
}

function RouteLoading() {
  const language = loadPreferences().language;
  return (
    <main className="app-shell">
      <div className="screen-texture" aria-hidden="true" />
      <div className="loading" role="status" aria-live="polite">
        <div className="loading-content">
          <span className="kicker">{translate(language, "entering")}</span>
          <VoidWordmark />
          <div className="loading-track">
            <i />
          </div>
          <span className="loading-status">{translate(language, "loadingGame")}</span>
        </div>
      </div>
    </main>
  );
}
