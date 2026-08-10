import { useState, useEffect } from "react";
import { SimulationProvider } from "./simulation/SimulationProvider";
import { AppShell } from "./components/layout/AppShell";
import { Dashboard } from "./pages/Dashboard/Dashboard";
import { Camera } from "./pages/Camera/Camera";
import { Logs } from "./pages/Logs/Logs";
import { SystemHealth } from "./pages/SystemHealth/SystemHealth";

function AppContent() {
  const [currentPath, setCurrentPath] = useState<string>(
    window.location.hash || "#/dashboard"
  );

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentPath(window.location.hash || "#/dashboard");
    };

    window.addEventListener("hashchange", handleHashChange);
    
    // Default redirect to dashboard
    if (!window.location.hash || window.location.hash === "#/") {
      window.location.hash = "#/dashboard";
    }

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigateTo = (path: string) => {
    window.location.hash = path;
    setCurrentPath(path);
  };

  const renderPage = () => {
    switch (currentPath) {
      case "#/camera":
        return <Camera />;
      case "#/logs":
        return <Logs />;
      case "#/system-health":
        return <SystemHealth />;
      case "#/dashboard":
      default:
        return <Dashboard />;
    }
  };

  return (
    <AppShell currentPath={currentPath} onNavigate={navigateTo}>
      {renderPage()}
    </AppShell>
  );
}

function App() {
  return (
    <SimulationProvider>
      <AppContent />
    </SimulationProvider>
  );
}

export default App;
