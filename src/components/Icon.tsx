import Svg, { Circle, Path } from 'react-native-svg';

export type IconName =
  | 'search'
  | 'chevron'
  | 'boat'
  | 'music'
  | 'buggy'
  | 'bed'
  | 'food';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
};

export function Icon({ name, size = 24, color = '#1E1E1E' }: Props) {
  const stroke = {
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'search' && (
        <>
          <Circle cx="11" cy="11" r="6.5" {...stroke} />
          <Path d="M16 16l4 4" {...stroke} />
        </>
      )}
      {name === 'chevron' && <Path d="M9 5l7 7-7 7" {...stroke} />}
      {name === 'boat' && (
        <>
          <Path d="M3 15h18l-2.5 4.5h-13z" {...stroke} />
          <Path d="M12 3v12M12 4l6 8h-6M12 6l-5 6h5" {...stroke} />
        </>
      )}
      {name === 'music' && (
        <>
          <Path d="M9 18V6l11-2v12" {...stroke} />
          <Circle cx="6.5" cy="18" r="2.5" {...stroke} />
          <Circle cx="17.5" cy="16" r="2.5" {...stroke} />
        </>
      )}
      {name === 'buggy' && (
        <>
          <Path d="M3 15v-3l3-1 2.5-4h6l2 4 4 1v3" {...stroke} />
          <Path d="M9.5 15h5" {...stroke} />
          <Circle cx="6.5" cy="16" r="2.5" {...stroke} />
          <Circle cx="17.5" cy="16" r="2.5" {...stroke} />
        </>
      )}
      {name === 'bed' && (
        <>
          <Path d="M3 7v12M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6" {...stroke} />
          <Circle cx="7" cy="11.5" r="1.8" {...stroke} />
        </>
      )}
      {name === 'food' && (
        <>
          <Path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3" {...stroke} />
          <Path d="M17 21V3c-2 1.5-3 4-3 7v4h3" {...stroke} />
        </>
      )}
    </Svg>
  );
}
