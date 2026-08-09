import React from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

/**
 * TERMÉKIKONOK
 *
 * A 6 termékszerephez tartozó, saját rajzú ikonok. Minden városban ugyanaz a
 * 6 forma szerepel, de a városhoz tartozó színpárral kiszínezve — így 36
 * termékhez elég 6 rajz, és minden város mégis saját arculatot kap.
 */

export type FoodIconName = 'sausage' | 'fries' | 'flatbread' | 'wrap' | 'cup' | 'swirl';

type Props = {
  name: string;
  size?: number;
  colors: readonly [string, string];
};

export const FoodIcon = React.memo(function FoodIcon({ name, size = 40, colors }: Props) {
  const [main, accent] = colors;

  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {renderFood(name, main, accent)}
    </Svg>
  );
});

function renderFood(name: string, main: string, accent: string): React.ReactElement {
  switch (name) {
    case 'sausage':
      return (
        <G>
          <Path
            d="M6 30c0-5 4-8 9-8h18c5 0 9 3 9 8s-4 8-9 8H15c-5 0-9-3-9-8Z"
            fill={accent}
            opacity={0.9}
          />
          <Path
            d="M9 28c2-4 7-6 15-6s13 2 15 6c-1.5 2-3 3-5 3H14c-2 0-3.5-1-5-3Z"
            fill={main}
          />
          <Path
            d="M12 26c4-1 8 2 12 0s8 1 12 0"
            stroke="#FFF"
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.55}
            fill="none"
          />
        </G>
      );

    case 'fries':
      return (
        <G>
          <Rect x={14} y={6} width={5} height={20} rx={2} fill={accent} />
          <Rect x={21} y={3} width={5} height={23} rx={2} fill={accent} opacity={0.85} />
          <Rect x={28} y={8} width={5} height={18} rx={2} fill={accent} />
          <Path d="M12 22h24l-3 18a3 3 0 0 1-3 2.6H18a3 3 0 0 1-3-2.6L12 22Z" fill={main} />
          <Path d="M15 30h18" stroke="#FFF" strokeWidth={2.4} opacity={0.4} strokeLinecap="round" />
        </G>
      );

    case 'flatbread':
      return (
        <G>
          <Circle cx={24} cy={24} r={17} fill={main} />
          <Circle cx={24} cy={24} r={12.5} fill={accent} opacity={0.55} />
          <Circle cx={18} cy={20} r={2.2} fill="#FFF" opacity={0.6} />
          <Circle cx={29} cy={26} r={2.6} fill="#FFF" opacity={0.5} />
          <Circle cx={22} cy={30} r={1.8} fill="#FFF" opacity={0.45} />
        </G>
      );

    case 'wrap':
      return (
        <G>
          <Path d="M14 8h16l8 32H6L14 8Z" fill={main} />
          <Path d="M17 8h10l6 24H11l6-24Z" fill={accent} opacity={0.7} />
          <Path
            d="M15 20h18M13 28h22"
            stroke="#FFF"
            strokeWidth={2.2}
            opacity={0.45}
            strokeLinecap="round"
          />
        </G>
      );

    case 'cup':
      return (
        <G>
          <Path d="M12 12h24l-3 28a3 3 0 0 1-3 2.6H18a3 3 0 0 1-3-2.6L12 12Z" fill={main} />
          <Rect x={10} y={8} width={28} height={6} rx={3} fill={accent} />
          <Path d="M24 2v8" stroke={accent} strokeWidth={3} strokeLinecap="round" />
          <Ellipse cx={24} cy={24} rx={8} ry={3} fill="#FFF" opacity={0.3} />
        </G>
      );

    case 'swirl':
      return (
        <G>
          <Path
            d="M24 4c7 0 12 4 12 9s-5 8-12 8-12-3-12-8 5-9 12-9Z"
            fill={accent}
          />
          <Path d="M14 19h20l-4 22a2.6 2.6 0 0 1-2.6 2.2h-6.8A2.6 2.6 0 0 1 18 41L14 19Z" fill={main} />
          <Path
            d="M17 25h14M18 32h12"
            stroke="#FFF"
            strokeWidth={2.2}
            opacity={0.45}
            strokeLinecap="round"
          />
        </G>
      );

    default:
      return <Circle cx={24} cy={24} r={16} fill={main} />;
  }
}
