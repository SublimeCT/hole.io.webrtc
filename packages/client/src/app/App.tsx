import { lazy, Suspense } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { HomePage } from "../pages/HomePage";
import { ResultsPage } from "../pages/ResultsPage";

const GamePage = lazy(() => import("../pages/GamePage"));

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
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
    </HashRouter>
  );
}

function RouteLoading() {
  return (
    <main className="app-shell">
      <div className="screen-texture" aria-hidden="true" />
      <div className="loading" role="status" aria-live="polite">
        <div className="loading-content">
          <span className="kicker">ENTERING DISTRICT</span>
          <strong>HOLE CITY</strong>
          <div className="loading-track">
            <i />
          </div>
          <span className="loading-status">LOADING GAME</span>
        </div>
      </div>
    </main>
  );
}
