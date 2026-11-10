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
          label: "Enhanced layout",
          subLabel: "Separate rounded panels for supported channel lists, headers and the message composer. Applies only while Midnight is selected. Restart Discord after changing this option.",
          value,
          onValueChange: async (enhancedLayout: boolean) => {
            await jsonStorage.set({ enhancedLayout });
            instance.requireReload();
          },
        }),
      ),
      h(TableRowGroup, { title: "Setup", children: null },
        row("Choose Midnight (Auto)", "Open Valenced Settings → Themes → Color themes → Midnight."),
        row("Font and moon icon", "Choose Midnight Figtree under Fonts and Midnight Moon under Icons. Restart Discord after applying fonts or icons."),
        row("Automatic appearance", "The palette follows Discord's appearance. Select automatic appearance in Discord to follow your device."),
      ),
      h(TableRowGroup, { title: "About", children: null },
        row("Midnight Mobile · 1.0.0-beta", "Desktop theme by refact0r. Mobile adaptation by dariuss. Desktop window controls and hover effects do not apply on mobile."),
      ),
    ),
  ));
}
