import {
  LucideBookOpen,
  LucideBug,
  LucideCloud,
  LucideDatabase,
  LucideEyeOff,
  LucideFileLock,
  LucideFish,
  LucideGlobe,
  LucideHouse,
  LucideKeyRound,
  LucideLaptop,
  LucideLock,
  LucideNetwork,
  LucideShieldCheck,
  LucideSmartphone,
  LucideUsb,
  LucideUsers,
  LucideWifi,
  type LucideIcon,
} from '@lucide/angular';
import type { SdSelectOption } from '@specora-dev/ui-kit';
import type { TopicIcon } from '../../core/api';

/**
 * The curated topic icons: every `TopicIcon` in the API spec, with the Lucide icon that shows it
 * and the name administrators pick it by. `satisfies` makes the build fail when the spec adds or
 * removes an icon and this list does not follow.
 */
export const TOPIC_ICONS = {
  fish: { icon: LucideFish, label: 'Phishing (fish)' },
  'key-round': { icon: LucideKeyRound, label: 'Passwords (key)' },
  lock: { icon: LucideLock, label: 'Access control (lock)' },
  'shield-check': { icon: LucideShieldCheck, label: 'Protection (shield)' },
  database: { icon: LucideDatabase, label: 'Data (database)' },
  'file-lock': { icon: LucideFileLock, label: 'Confidential documents (locked file)' },
  'eye-off': { icon: LucideEyeOff, label: 'Privacy (hidden eye)' },
  users: { icon: LucideUsers, label: 'People and social engineering (people)' },
  globe: { icon: LucideGlobe, label: 'Internet (globe)' },
  wifi: { icon: LucideWifi, label: 'Wi-Fi (signal)' },
  network: { icon: LucideNetwork, label: 'Network (network)' },
  cloud: { icon: LucideCloud, label: 'Cloud services (cloud)' },
  laptop: { icon: LucideLaptop, label: 'Computers (laptop)' },
  smartphone: { icon: LucideSmartphone, label: 'Mobile devices (phone)' },
  usb: { icon: LucideUsb, label: 'Removable media (USB)' },
  house: { icon: LucideHouse, label: 'Remote work (house)' },
  bug: { icon: LucideBug, label: 'Malware (bug)' },
} as const satisfies Record<TopicIcon, { icon: LucideIcon; label: string }>;

/** The Lucide icon for a topic's icon name, or null for none. */
export function topicIcon(name: TopicIcon | null): LucideIcon | null {
  return name ? TOPIC_ICONS[name].icon : null;
}

/**
 * The icon for a topic in a list: its own icon, or the generic topic icon (the one in the side
 * navigation) when it has none, so every name lines up in the same column.
 */
export const TOPIC_FALLBACK_ICON: LucideIcon = LucideBookOpen;
export function topicListIcon(name: TopicIcon | null): LucideIcon {
  return topicIcon(name) ?? TOPIC_FALLBACK_ICON;
}

/** The icon picker's options, in the order above. */
export const TOPIC_ICON_OPTIONS: SdSelectOption<TopicIcon>[] = (
  Object.keys(TOPIC_ICONS) as TopicIcon[]
).map((name) => ({ value: name, label: TOPIC_ICONS[name].label }));
