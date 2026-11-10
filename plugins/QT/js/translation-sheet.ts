import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { ActionSheetActionCreators } from "@valenced/discord/actions";
import { Design } from "@valenced/discord/design";
import { useWindowDimensions } from "react-native";

export function TranslationSheet({ sheetKey, title, children, onClose }: {
  sheetKey: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const active = useRef(false);
  // Discord renders the sheet in its own tree, so keep its content in sync with the composer.
  const sheet = useMemo(() => {
    let content: ReactNode = null;
    const listeners = new Set<() => void>();
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    };
    const getContent = () => content;
    return {
      Component: () => useSyncExternalStore(subscribe, getContent),
      update(next: ReactNode) {
        content = next;
        for (const listener of listeners) listener();
      },
    };
  }, []);
  useLayoutEffect(() => {
    sheet.update(h(Design.ActionSheet, {
      startExpanded: true,
      scrollable: true,
      maxHeight: Math.round(height * 0.9),
      header: h(Design.BottomSheetTitleHeader, { title }),
      onDismiss: () => { if (active.current) onClose(); },
      children,
    }));
  }, [sheet, height, title, children, onClose]);
  useEffect(() => {
    active.current = true;
    ActionSheetActionCreators.openLazy(Promise.resolve({ default: sheet.Component }), sheetKey, {});
    return () => {
      active.current = false;
      ActionSheetActionCreators.hideActionSheet(sheetKey);
    };
  }, [sheet, sheetKey]);
  return null;
}
