import { mountAppRoot } from "@/main";
import { TrayI18nProvider } from "./shared";
import { TrayApp } from "./TrayApp";
import { TrayDetailApp } from "./TrayDetailApp";

const trayParams = new URLSearchParams(window.location.search);
const trayMode = trayParams.get("mode");
const trayProvider = trayParams.get("provider")?.trim() || undefined;

mountAppRoot(
  <TrayI18nProvider>
    {trayMode === "detail" ? <TrayDetailApp provider={trayProvider} /> : <TrayApp />}
  </TrayI18nProvider>
);
