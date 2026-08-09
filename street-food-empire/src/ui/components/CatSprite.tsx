import React from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

/**
 * MACSKAVENDÉGEK
 *
 * Egyetlen paraméteres rajz, amiből a `look` szám determinisztikusan
 * származtat egy külsőt: bunda, minta, kiegészítő, arckifejezés. Így egy ~120
 * soros komponensből több száz megkülönböztethető macska jön ki, nulla
 * képfájllal.
 *
 * A rajz szándékosan kevés útvonalból áll: egyszerre 5-6 macska van a
 * képernyőn, 5 Hz-en újrarajzolva, és a bonyolult SVG-útvonalak
 * raszterizálása belépőszintű Androidon mérhetően drágább.
 */

type Props = {
  /** Tetszőleges egész – ebből származik a teljes külső. */
  look: number;
  size?: number;
  /** Elégedett (kiszolgált) vagy csalódott (elfogyott a türelme). */
  mood?: 'neutral' | 'happy' | 'sad';
};

type CatCoat = {
  fur: string;
  patch: string;
  ear: string;
};

/** Bundapaletták – meleg, cukrászdába illő tónusok. */
const COATS: readonly CatCoat[] = [
  { fur: '#F2C094', patch: '#E09A5F', ear: '#F5B2B2' }, // ginger tabby
  { fur: '#E8E4DC', patch: '#C9C3B8', ear: '#F0B8BC' }, // cream
  { fur: '#9DA3AE', patch: '#7B8291', ear: '#E6A6AC' }, // grey
  { fur: '#4A4550', patch: '#332F3A', ear: '#C98F96' }, // fekete
  { fur: '#F7EDE2', patch: '#EFB68C', ear: '#F3AEB4' }, // calico
  { fur: '#D8B08C', patch: '#B98A63', ear: '#EDA9AF' }, // homok
  { fur: '#B8CBD8', patch: '#93AEC0', ear: '#E4A3AA' }, // blue grey
];

/** Kiegészítők – ezek adják a legtöbb felismerhető változatosságot. */
type Accessory = 'none' | 'scarf' | 'cap' | 'bow' | 'glasses';
const ACCESSORIES: readonly Accessory[] = ['none', 'scarf', 'cap', 'bow', 'glasses', 'scarf', 'none'];

const ACCENTS = ['#EB5757', '#56CCF2', '#6FCF97', '#BB6BD9', '#F2C94C'] as const;

export const CatSprite = React.memo(function CatSprite({
  look,
  size = 54,
  mood = 'neutral',
}: Props) {
  // A `look` különböző számjegyeiből vesszük a jellemzőket, hogy a szomszédos
  // értékek se adjanak hasonló macskát.
  const coat = COATS[look % COATS.length] ?? COATS[0]!;
  const accessory = ACCESSORIES[Math.floor(look / 7) % ACCESSORIES.length] ?? 'none';
  const accent = ACCENTS[Math.floor(look / 11) % ACCENTS.length] ?? ACCENTS[0];
  const hasPatch = Math.floor(look / 3) % 3 !== 0;
  const stripes = Math.floor(look / 5) % 4 === 0;

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {/* --- Farok --- */}
      <Path
        d="M46 46c7 1 10-3 9-8"
        stroke={coat.fur}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />

      {/* --- Test --- */}
      <Path
        d="M20 60c0-9 5.4-15 12-15s12 6 12 15H20Z"
        fill={coat.fur}
      />
      {hasPatch ? (
        <Path d="M32 45c4.6 0 8.4 3 10.4 7.6-3 1.6-6.6 2.4-10.4 2.4V45Z" fill={coat.patch} />
      ) : null}

      {/* --- Ears --- */}
      <Path d="M18 26 16 12l12 6-10 8Z" fill={coat.fur} />
      <Path d="M46 26 48 12l-12 6 10 8Z" fill={coat.fur} />
      <Path d="M20.5 23 19.5 16l6 3-5 4Z" fill={coat.ear} />
      <Path d="M43.5 23 44.5 16l-6 3 5 4Z" fill={coat.ear} />

      {/* --- Fej --- */}
      <Ellipse cx={32} cy={30} rx={16} ry={14} fill={coat.fur} />
      {stripes ? (
        <G stroke={coat.patch} strokeWidth={2} strokeLinecap="round" opacity={0.8}>
          <Path d="M28 18.5v3.5M32 17.8v4M36 18.5v3.5" />
        </G>
      ) : null}

      {/* --- Szem --- */}
      {mood === 'happy' ? (
        <G stroke="#2B2632" strokeWidth={2.4} strokeLinecap="round" fill="none">
          <Path d="M23 30c1.6-2.2 4.4-2.2 6 0" />
          <Path d="M35 30c1.6-2.2 4.4-2.2 6 0" />
        </G>
      ) : mood === 'sad' ? (
        <G stroke="#2B2632" strokeWidth={2.4} strokeLinecap="round" fill="none">
          <Path d="M23 29c1.6 2.2 4.4 2.2 6 0" />
          <Path d="M35 29c1.6 2.2 4.4 2.2 6 0" />
        </G>
      ) : (
        <G fill="#2B2632">
          <Ellipse cx={26} cy={29.5} rx={2.4} ry={3} />
          <Ellipse cx={38} cy={29.5} rx={2.4} ry={3} />
          <Circle cx={26.9} cy={28.4} r={0.9} fill="#FFF" />
          <Circle cx={38.9} cy={28.4} r={0.9} fill="#FFF" />
        </G>
      )}

      {/* --- Nose and whiskers --- */}
      <Path d="M32 34.4l-2 1.6h4l-2-1.6Z" fill={coat.ear} />
      <G stroke={coat.patch} strokeWidth={1.2} strokeLinecap="round" opacity={0.75}>
        <Path d="M16 32h6M16 36h6M42 32h6M42 36h6" />
      </G>

      {/* --- Accessories --- */}
      {accessory === 'scarf' ? (
        <G>
          <Rect x={22} y={42} width={20} height={6} rx={3} fill={accent} />
          <Path d="M40 46l5 7-6-1 1-6Z" fill={accent} />
        </G>
      ) : null}

      {accessory === 'cap' ? (
        <G>
          <Path d="M18 20c1-7 6.6-11 14-11s13 4 14 11H18Z" fill={accent} />
          <Rect x={16} y={19} width={32} height={4} rx={2} fill={accent} />
          <Circle cx={32} cy={11} r={2.6} fill="#FFF" opacity={0.8} />
        </G>
      ) : null}

      {accessory === 'bow' ? (
        <G>
          <Path d="M44 17l-6 4 6 4v-8Z" fill={accent} />
          <Path d="M52 17l6 4-6 4v-8Z" fill={accent} />
          <Circle cx={48} cy={21} r={2.6} fill={accent} />
        </G>
      ) : null}

      {accessory === 'glasses' ? (
        <G stroke="#2B2632" strokeWidth={1.8} fill="none" opacity={0.85}>
          <Circle cx={26} cy={29.5} r={5} />
          <Circle cx={38} cy={29.5} r={5} />
          <Path d="M31 29.5h2" />
        </G>
      ) : null}
    </Svg>
  );
});

/**
 * Gondolatbuborék a macska fölé: mit szeretne venni.
 *
 * Csak a buborék *alakját* rajzolja; a termékikont a hívó rétegzi rá egy
 * abszolút pozíciójú nézettel. Azért így, mert az egymásba ágyazott `<Svg>`
 * méretezése platformonként (iOS / Android / web) eltérően viselkedik.
 */
export function WantBubble({
  size = 34,
  urgent,
}: {
  size?: number;
  urgent?: boolean;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" style={{ position: 'absolute' }}>
      <G>
        <Rect
          x={2}
          y={2}
          width={36}
          height={28}
          rx={9}
          fill={urgent ? '#FFE9C7' : '#FFFFFF'}
          stroke={urgent ? '#EB5757' : '#332F47'}
          strokeWidth={2}
        />
        <Path
          d="M14 29l-3 7 9-7h-6Z"
          fill={urgent ? '#FFE9C7' : '#FFFFFF'}
          stroke={urgent ? '#EB5757' : '#332F47'}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </G>
    </Svg>
  );
}
