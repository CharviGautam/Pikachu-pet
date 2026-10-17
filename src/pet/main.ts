import { PikachuApp } from "./app";

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("pet-canvas") as HTMLCanvasElement;
  if (!canvas) {
    console.error("Canvas element #pet-canvas not found!");
    return;
  }

  const app = new PikachuApp(canvas);
  void app.start();

  // Browser-dev test hook: the native tray/context menus don't exist here, so
  // expose the same menu handler for manual testing from the devtools console
  // (`__pikachu.menu("sleep_toggle")`, `"mini"`, `"throw_ball"`, …).
  // Never present in the Tauri build.
  if (!("__TAURI_INTERNALS__" in window)) {
    (window as unknown as { __pikachu: unknown }).__pikachu = {
      app,
      menu: (action: string) =>
        (app as unknown as { handleMenuAction(a: string): void }).handleMenuAction(action),
    };
  }
});
