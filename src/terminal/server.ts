import { render } from "svelte/server";
import App from "./App.svelte";

export function renderSvelteApp(): string {
  const { html } = render(App);
  return html;
}
