import * as React from "react";
import Page from "@valenced/components/Page";
import { Design } from "@valenced/discord/design";
import { ScrollView } from "react-native";

export default function Settings({ api: { jsonStorage, plugin: instance } }: any) {
  const value = jsonStorage.use((data: any) => "enhancedLayout" in data)?.enhancedLayout ?? true;
  const { Stack, TableRowGroup, TableSwitchRow, TableRow } = Design;
  const h = React.createElement;
  const row = (label: string, subLabel: string) => h(TableRow, { key: label, label, subLabel });
  return h(Page, {}, h(ScrollView, { contentContainerStyle: { paddingBottom: 24 } },
    h(Stack, { spacing: 24 },
      h(TableRowGroup, { title: "Appearance", children: null },
        h(TableSwitchRow, {
          label: "Rounded surfaces",
          subLabel: "Round supported existing surfaces without moving or clipping Discord controls. Applies only while Midnight is selected. Restart Discord after changing this option.",
          value,
          onValueChange: async (enhancedLayout: boolean) => {
            await jsonStorage.set({ enhancedLayout });
            instance.requireReload();
          },
        }),
      ),
      h(TableRowGroup, { title: "Setup", children: null },
        row("Choose Midnight (Auto)", "Open Valenced Settings → Themes → Color themes → Midnight."),
        row("Font and moon icon", "The navigation moon is included with Midnight and default icons. Choose Midnight Figtree under Fonts; Midnight Moon under Icons also replaces Home/Clyde icons. Restart after font or icon changes."),
        row("Automatic appearance", "The palette follows Discord's appearance. Select automatic appearance in Discord to follow your device."),
      ),
      h(TableRowGroup, { title: "About", children: null },
        row("Midnight Mobile · 1.0.2-beta", "Desktop theme by refact0r. Mobile adaptation by dariuss. Desktop window controls and hover effects do not apply on mobile."),
      ),
    ),
  ));
}
