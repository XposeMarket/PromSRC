// Keep the drawer's existing theme button appearance; let the OS present choices.
import { attachNativePicker } from './mobile-native-picker.js';

export function bindMobileThemePicker(button, { themes, current, apply }) {
  return attachNativePicker(button, {
    label: 'Theme',
    options: () => (typeof themes === 'function' ? themes() : themes).map(theme => ({
      value: theme.id,
      label: theme.label || theme.name || theme.id,
      selected: theme.id === current(),
    })),
    onChange: value => apply(value),
  });
}
