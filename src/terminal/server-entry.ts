import { render } from "svelte/server";
import App from "../terminal/App.svelte";

export function renderApp(): string {
  const { html } = render(App);
  return html;
}
