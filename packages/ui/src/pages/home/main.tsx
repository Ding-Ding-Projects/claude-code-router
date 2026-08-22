import React from "react";
import { mountAppRoot } from "@/main";
import { BaseUiProvider } from "@/lib/baseui-provider";
import App from "./App";

mountAppRoot(
  <React.StrictMode>
    <BaseUiProvider>
      <App />
    </BaseUiProvider>
  </React.StrictMode>
);
