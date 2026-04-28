export const colors = {
  background: '#040404',
  surface: '#111111',
  text: '#FFFFFF',
  textMuted: '#808080',
  accentBlue: '#7DA4C7',
  accentYellow: '#CDD746',
  accentWhite: '#F0F0F0',
  border: '#222222',
};

/**
 * Typography system modelled after Neue Haas Grotesk Display.
 *
 * Inter weight mapping:
 *   200 ExtraLight  →  massive display numerals & hero titles (thin, elegant)
 *   300 Light       →  large headings (h1)
 *   400 Regular     →  body text
 *   500 Medium      →  h3, labels, interactive text
 *   600 SemiBold    →  buttons, caps labels
 */
export const typography = {
  /** Hero-scale display text — massive numbers, names */
  display: {
    fontFamily: 'Inter-ExtraLight',
    fontSize: 72,
    lineHeight: 76,
    letterSpacing: -2,
    fontWeight: '200' as const,
  },
  /** Primary heading */
  h1: {
    fontFamily: 'Inter-Light',
    fontSize: 48,
    lineHeight: 52,
    letterSpacing: -1,
    fontWeight: '300' as const,
  },
  /** Secondary heading */
  h2: {
    fontFamily: 'Inter-Light',
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.5,
    fontWeight: '300' as const,
  },
  /** Section heading / sub-label */
  h3: {
    fontFamily: 'Inter-Medium',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0,
    fontWeight: '500' as const,
  },
  /** Default readable body text */
  body: {
    fontFamily: 'Inter-Regular',
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0,
    fontWeight: '400' as const,
  },
  /** Small metadata / allcaps labels */
  caption: {
    fontFamily: 'Inter-Medium',
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.5,
    fontWeight: '500' as const,
  },
};
