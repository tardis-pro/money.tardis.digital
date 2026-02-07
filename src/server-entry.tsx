import { renderToString } from "react-dom/server";
import { App } from "./App.js";

export function renderApp() {
  return renderToString(<App />);
}
