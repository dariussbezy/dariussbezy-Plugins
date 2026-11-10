import { createElement as h, isValidElement, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { Design, FormSwitch } from "@valenced/discord/design";

export function NativeSection({ title, children }: { title?: string; children?: ReactNode }) {
  return h(Design.TableRowGroup, { title, children });
}

type NativeRowProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  subtitleLines?: number;
  trailing?: ReactNode;
  onPress?: () => void;
};

export function NativeRow({ title, subtitle, subtitleLines = 5, trailing, onPress }: NativeRowProps) {
  const label = { label: title, subLabel: subtitle, subLabelLineClamp: subtitleLines };
  if (isValidElement<ComponentProps<typeof NativeSwitch>>(trailing) && trailing.type === NativeSwitch) {
    return h(Design.TableSwitchRow, {
      ...label,
      value: !!trailing.props.value,
      onValueChange: trailing.props.onChange,
    });
  }
  return h(Design.TableRow, { ...label, trailing, onPress, arrow: !!onPress && !trailing });
}

export function NativeSwitch({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return h(FormSwitch, { value: !!value, onValueChange: onChange });
}

export function NativeAction({ title, onPress, compact, secondary, danger, disabled, top }: {
  title: string;
  onPress: () => void;
  compact?: boolean;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  top?: number;
}) {
  return h(Design.Button, {
    text: title,
    onPress,
    size: compact ? "sm" : "md",
    variant: danger ? "destructive" : secondary ? "secondary" : "primary",
    disabled,
    style: { marginTop: top ?? 8 },
  });
}

type NativeInputProps = Omit<ComponentProps<typeof Design.TextInput>, "onChange"> & {
  onChangeText: (value: string) => void;
};
export function NativeInput({ onChangeText, ...props }: NativeInputProps) {
  return h(Design.TextInput, { ...props, onChange: onChangeText });
}

export function NativeOverview({ title, subtitle, stats }: {
  title: string;
  subtitle: string;
  stats?: readonly (readonly [string, ReactNode])[];
}) {
  return h(NativeSection, {
    title,
    children: [
      h(Design.TableRow, { key: "summary", label: subtitle }),
      ...(stats?.map(([label, value]) =>
        h(Design.TableRow, { key: label, label, subLabel: typeof value === "number" ? String(value) : value }),
      ) ?? []),
    ],
  });
}

export function NativeGuide({ title, steps }: {
  title: string;
  steps: readonly (readonly [string, string])[];
}) {
  const [open, setOpen] = useState(true);
  return h(NativeSection, {
    children: [
      h(Design.TableSwitchRow, { key: "guide", label: title, value: open, onValueChange: setOpen }),
      ...(open ? steps.map(([label, subLabel]) =>
        h(Design.TableRow, { key: label, label, subLabel, subLabelLineClamp: 12 }),
      ) : []),
    ],
  });
}
