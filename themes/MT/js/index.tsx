/// <reference types="@valenced/themes-api" />

import palette from "./palette.json";

let Settings: ((props: any) => any) | undefined;

export default plugin<{ jsonStorage: { enhancedLayout: boolean } }>({
  jsonStorage: { load: true, default: { enhancedLayout: true } },
  preInit({ themes }) {
    themes.registerGroup("midnight", {
      name: "Midnight", description: "Midnight by refact0r, adapted for mobile by dariuss.",
    });
    themes.registerTheme("midnight", "auto", {
      name: "Midnight (Auto)",
      description: "Blue accents, translucent navy panels and the original Midnight wallpaper. Follows Discord's light or dark appearance.",
      getColors: () => palette,
      background: { path: "assets/wallpaper.png", opacity: 1, blur: 12, dimming: 0.55 },
    });
    const families: Record<string, import("@valenced/themes-api/types").FontVariant[]> = {};
    for (const [suffix, weight] of Object.entries({ Normal: 400, Medium: 500, Semibold: 600, Bold: 700, ExtraBold: 800 })) {
      for (const italic of [false, true]) {
        families[`ggsans-${suffix}${italic ? "Italic" : ""}`] = [{
          path: italic ? "assets/Figtree-Italic.ttf" : "assets/Figtree.ttf", weight, italic, axes: { wght: weight },
        }];
      }
    }
    themes.registerFontPack("midnight", "figtree", {
      name: "Midnight Figtree", description: "Original Figtree typography, including bold and italic.", families,
    });
    themes.registerIconPack("midnight", "moon", {
      name: "Midnight Moon", description: "Original Font Awesome moon in place of the Discord Clyde logo.",
      icons: { ClydeIcon: "assets/moon.png" },
    });
  },
  async init() {
    Settings = (await import("./settings")).default;
  },
  async start({ jsonStorage, cleanup, plugin: instance }) {
    const { startLayout } = await import("./layout");
    const settings = await jsonStorage.get();
    cleanup(startLayout(settings.enhancedLayout !== false, (error: unknown) => instance.reportError(error)));
    if (instance.startedLate) instance.requireReload();
  },
  SettingsComponent: props => Settings ? Settings(props) : null,
});
