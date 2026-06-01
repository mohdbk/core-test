import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./Layout.jsx";
import ConfigView from "./views/ConfigView.jsx";
import ConsoleView from "./views/ConsoleView.jsx";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Operations Console is the primary screen; Configure edits zones,
            detectors, rules. */}
        <Route index                       element={<Navigate to="/console" replace />} />
        <Route path="/console"             element={<ConsoleView />} />
        <Route path="/console/:cameraId"   element={<ConsoleView />} />
        <Route path="/config"              element={<ConfigView />} />
        <Route path="/config/:cameraId"    element={<ConfigView />} />
        {/* Legacy /stream redirects for cached bookmarks. */}
        <Route path="/stream"              element={<Navigate to="/console" replace />} />
        <Route path="/stream/:cameraId"    element={<Navigate to="/console" replace />} />
        <Route path="*"                    element={<Navigate to="/console" replace />} />
      </Route>
    </Routes>
  );
}
