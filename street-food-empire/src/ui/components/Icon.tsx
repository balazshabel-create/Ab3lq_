import React from 'react';
import Svg, { Circle, Path, Rect, G } from 'react-native-svg';

import { palette } from '@/ui/theme';

/**
 * SAJÁT IKONKÉSZLET
 *
 * Minden ikon kézzel rajzolt SVG útvonal — nincs külső ikoncsomag, nincs
 * licencprobléma, és nincs egyetlen bittérképes asset sem. Előnyök:
 *  - bármilyen méretben éles (nincs @2x/@3x asset-halmaz),
 *  - a teljes készlet néhány KB, nem növeli az APK méretét,
 *  - futásidőben átszínezhető (kozmetikai csomagok).
 *
 * A rajzok szándékosan egyszerű geometriák: gyenge készüléken az összetett
 * útvonalak raszterizálása mérhetően lassabb.
 */

export type IconName =
  | 'flame'
  | 'droplet'
  | 'bread'
  | 'snow'
  | 'star'
  | 'coin'
  | 'box'
  | 'moon'
  | 'hand'
  | 'chef'
  | 'scooter'
  | 'cashier'
  | 'megaphone'
  | 'clock'
  | 'city'
  | 'quest'
  | 'shop'
  | 'settings'
  | 'stand'
  | 'upgrade'
  | 'play'
  | 'lock'
  | 'check'
  | 'close'
  | 'crate'
  | 'trophy';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  /** Másodlagos szín a kétszínű ikonokhoz. */
  tint?: string;
};

export const Icon = React.memo(function Icon({
  name,
  size = 24,
  color = palette.text,
  tint,
}: Props) {
  const secondary = tint ?? color;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {renderIcon(name, color, secondary)}
    </Svg>
  );
});

function renderIcon(name: IconName, color: string, tint: string): React.ReactElement {
  switch (name) {
    case 'flame':
      return (
        <Path
          d="M12 2.5c.6 3.4-1.2 4.6-2.6 6C7.6 10.2 6 11.8 6 14.4 6 18 8.7 21 12 21s6-3 6-6.6c0-2.4-1.3-3.7-2.4-5.2-.5.9-1.2 1.4-2 1.6.8-2.7.2-5.6-1.6-8.3Z"
          fill={color}
        />
      );

    case 'droplet':
      return (
        <Path
          d="M12 2.5c3.6 4.2 6 7.3 6 10.4 0 3.6-2.7 6.1-6 6.1s-6-2.5-6-6.1c0-3.1 2.4-6.2 6-10.4Z"
          fill={color}
        />
      );

    case 'bread':
      return (
        <G>
          <Path
            d="M4 10.5c0-2.5 3.6-4 8-4s8 1.5 8 4v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6Z"
            fill={color}
          />
          <Path d="M8 11.5v5M12 11.5v5M16 11.5v5" stroke={tint} strokeWidth={1.4} opacity={0.45} />
        </G>
      );

    case 'snow':
      return (
        <G stroke={color} strokeWidth={1.8} strokeLinecap="round">
          <Path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
        </G>
      );

    case 'star':
      return (
        <Path
          d="m12 3 2.6 5.6 6 .8-4.4 4.3 1.1 6.1L12 17l-5.3 2.8 1.1-6.1L3.4 9.4l6-.8L12 3Z"
          fill={color}
        />
      );

    case 'coin':
      return (
        <G>
          <Circle cx={12} cy={12} r={9} fill={color} />
          <Circle cx={12} cy={12} r={6} fill="none" stroke={tint} strokeWidth={1.6} opacity={0.5} />
        </G>
      );

    case 'box':
      return (
        <G>
          <Path d="M3 8.2 12 4l9 4.2v8L12 20.4 3 16.2v-8Z" fill={color} />
          <Path d="M3 8.2 12 12.4l9-4.2M12 12.4v8" stroke={tint} strokeWidth={1.4} opacity={0.45} />
        </G>
      );

    case 'moon':
      return (
        <Path
          d="M20 14.4A8.4 8.4 0 0 1 9.6 4 8.6 8.6 0 1 0 20 14.4Z"
          fill={color}
        />
      );

    case 'hand':
      return (
        <Path
          d="M8 11V5.6a1.6 1.6 0 0 1 3.2 0V10h.8V4.2a1.6 1.6 0 0 1 3.2 0V10h.8V6.4a1.6 1.6 0 0 1 3.2 0v8.2c0 3.5-2.6 6.4-6.2 6.4-2 0-3.6-.8-4.8-2.3L4.6 14a1.5 1.5 0 0 1 2.2-2L8 13.2V11Z"
          fill={color}
        />
      );

    case 'chef':
      return (
        <G>
          <Path
            d="M6 12a4 4 0 0 1 .6-7.9 4 4 0 0 1 7.4-1.3A4 4 0 0 1 18 12v1H6v-1Z"
            fill={color}
          />
          <Rect x={6} y={14} width={12} height={6} rx={1.6} fill={tint} opacity={0.75} />
        </G>
      );

    case 'scooter':
      return (
        <G>
          <Circle cx={6} cy={17} r={3} fill={color} />
          <Circle cx={18} cy={17} r={3} fill={color} />
          <Path
            d="M6 17h6l3-8h2.5"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
          />
          <Rect x={13} y={9} width={5} height={4} rx={1} fill={tint} opacity={0.8} />
        </G>
      );

    case 'cashier':
      return (
        <G>
          <Rect x={3.5} y={9} width={17} height={11} rx={2} fill={color} />
          <Rect x={7} y={4} width={10} height={4} rx={1.2} fill={tint} opacity={0.8} />
          <Path d="M7.5 13h9" stroke={palette.bg} strokeWidth={1.6} strokeLinecap="round" />
        </G>
      );

    case 'megaphone':
      return (
        <G>
          <Path d="M4 10v4l10 4V6L4 10Z" fill={color} />
          <Path
            d="M16 8.5a4 4 0 0 1 0 7"
            stroke={tint}
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
          />
        </G>
      );

    case 'clock':
      return (
        <G>
          <Circle cx={12} cy={12} r={9} fill="none" stroke={color} strokeWidth={2} />
          <Path d="M12 7v5.4l3.4 2" stroke={color} strokeWidth={2} strokeLinecap="round" />
        </G>
      );

    case 'city':
      return (
        <G>
          <Rect x={3} y={10} width={6} height={11} rx={1} fill={color} />
          <Rect x={10} y={5} width={5} height={16} rx={1} fill={color} opacity={0.85} />
          <Rect x={16} y={12} width={5} height={9} rx={1} fill={tint} opacity={0.7} />
        </G>
      );

    case 'quest':
      return (
        <G>
          <Path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill={color} />
          <Path
            d="m8.5 12.5 2.2 2.2 4.3-4.4"
            stroke={palette.bg}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </G>
      );

    case 'shop':
      return (
        <G>
          <Path d="M4 8h16l-1 3H5L4 8Z" fill={tint} />
          <Path d="M5 11h14v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9Z" fill={color} />
          <Path d="M9 4h6l1 4H8l1-4Z" fill={tint} opacity={0.7} />
        </G>
      );

    case 'settings':
      return (
        <G>
          <Circle cx={12} cy={12} r={3.2} fill="none" stroke={color} strokeWidth={2} />
          <Path
            d="M12 2.8v2.4M12 18.8v2.4M4.7 7.4l2 1.2M17.3 15.4l2 1.2M4.7 16.6l2-1.2M17.3 8.6l2-1.2"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </G>
      );

    case 'stand':
      return (
        <G>
          <Path d="M3 9.5 5 5h14l2 4.5H3Z" fill={tint} />
          <Rect x={4.5} y={10} width={15} height={9.5} rx={1.4} fill={color} />
          <Rect x={8} y={13} width={8} height={6.5} rx={1} fill={palette.bg} opacity={0.35} />
        </G>
      );

    case 'upgrade':
      return (
        <G>
          <Path
            d="m12 3.5 7 7h-4v9.5H9V10.5H5l7-7Z"
            fill={color}
          />
        </G>
      );

    case 'play':
      return <Path d="M8 5.2 19 12 8 18.8V5.2Z" fill={color} />;

    case 'lock':
      return (
        <G>
          <Rect x={5} y={10.5} width={14} height={10} rx={2.2} fill={color} />
          <Path
            d="M8.5 10.5V8a3.5 3.5 0 1 1 7 0v2.5"
            stroke={color}
            strokeWidth={2}
            fill="none"
          />
        </G>
      );

    case 'check':
      return (
        <Path
          d="m5 12.5 4.5 4.5L19 7"
          stroke={color}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      );

    case 'close':
      return (
        <Path
          d="M6 6l12 12M18 6L6 18"
          stroke={color}
          strokeWidth={2.4}
          strokeLinecap="round"
          fill="none"
        />
      );

    case 'crate':
      return (
        <G>
          <Rect x={3.5} y={7.5} width={17} height={12} rx={2} fill={color} />
          <Path d="M3.5 12h17" stroke={tint} strokeWidth={2} />
          <Rect x={10} y={7.5} width={4} height={12} fill={tint} opacity={0.85} />
          <Path d="M9 7.5c0-2 1.4-3.5 3-3.5s3 1.5 3 3.5" stroke={tint} strokeWidth={1.8} fill="none" />
        </G>
      );

    case 'trophy':
      return (
        <G>
          <Path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" fill={color} />
          <Path d="M7 5.5H4.5V7A3 3 0 0 0 7 10M17 5.5h2.5V7A3 3 0 0 1 17 10" stroke={color} strokeWidth={1.6} fill="none" />
          <Rect x={9.5} y={14} width={5} height={4} fill={color} />
          <Rect x={7} y={18} width={10} height={2.4} rx={1.2} fill={tint} />
        </G>
      );

    default:
      return <Circle cx={12} cy={12} r={8} fill={color} />;
  }
}
