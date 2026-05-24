import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./Layout.jsx";
import ConfigView from "./views/ConfigView.jsx";
import StreamView from "./views/StreamView.jsx";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Live monitoring is the primary screen; Configure is a secondary
            tab reached from the nav rail. */}
        <Route index element={<Navigate to="/stream" replace />} />
        <Route path="/stream" element={<StreamView />} />
        <Route path="/stream/:cameraId" element={<StreamView />} />
        <Route path="/config" element={<ConfigView />} />
        <Route path="/config/:cameraId" element={<ConfigView />} />
        <Route path="*" element={<Navigate to="/stream" replace />} />
      </Route>
    </Routes>
  );
}
