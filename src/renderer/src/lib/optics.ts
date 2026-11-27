// lib/optics.ts — Cognitive & broadcast teleprompter viewport-responsive typography

import type { Settings } from '../../../shared/types'

export interface StageOptics {
  effectiveFontSize: number
  effectiveLineHeight: number
  effectiveLetterSpacing: number
  effectivePaddingX: number
  effectivePaddingY: number
  estimatedCpl: number
}

type OpticsSettings = Pick<
  Settings,
  'fontSize' | 'lineHeight' | 'letterSpacing' | 'padding' | 'maxContentWidth' | 'responsiveScale'
>

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/**
 * Approximate perceptual luminance from a 6-digit hex color to detect dark-polarity displays
 * where irradiation/halation warrants slight counterform tracking compensation.
 */
export function isDarkColor(hex: string): boolean {
  const clean = hex.replace('#', '')
  if (clean.length < 6) return true
  const r = Number.parseInt(clean.slice(0, 2), 16)
  const g = Number.parseInt(clean.slice(2, 4), 16)
  const b = Number.parseInt(clean.slice(4, 6), 16)
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return true
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
}

/**
 * Compute responsive typography metrics from container dimensions and user preferences:
 * - Scales text proportionally with viewport width (anchored at a 480px reader stage)
 * - Caps automatic enlargement on wide/short banner windows so at least ~3 lines fit vertically
 * - Tunes line-height based on characters-per-line (CPL) and adds subtle dark-polarity halation tracking
 */
export function computeStageOptics(
  stageWidth: number,
  stageHeight: number,
  settings: OpticsSettings,
  darkPolarity = true
): StageOptics {
  const safeW = stageWidth > 0 ? stageWidth : 480
  const safeH = stageHeight > 0 ? stageHeight : 320

  if (!settings.responsiveScale) {
    const measureW =
      settings.maxContentWidth > 0 ? Math.min(settings.maxContentWidth, safeW) : safeW
    const cpl = Math.max(10, Math.round((measureW - settings.padding * 2) / (settings.fontSize * 0.54)))
    return {
      effectiveFontSize: settings.fontSize,
      effectiveLineHeight: Number(settings.lineHeight.toFixed(2)),
      effectiveLetterSpacing: settings.letterSpacing,
      effectivePaddingX: settings.padding,
      effectivePaddingY: settings.padding,
      estimatedCpl: cpl
    }
  }

  const effectivePaddingX = Math.round(
    clamp(safeW * 0.04, Math.min(settings.padding, 10), Math.max(settings.padding, 48))
  )
  const effectivePaddingY = Math.round(
    clamp(safeH * 0.075, Math.min(settings.padding, 8), Math.max(settings.padding, 36))
  )

  const usableW = Math.max(120, safeW - effectivePaddingX * 2)
  const usableH = Math.max(48, safeH - effectivePaddingY * 2)
  const constrainedW =
    settings.maxContentWidth > 0 ? Math.min(settings.maxContentWidth, usableW) : usableW

  // Anchor 1.0x scale at ~460px inner width; widen comfortably to fill banners, shrink smoothly < 360px
  const widthRatio = Math.pow(constrainedW / 460, 0.62)
  const clampedScale = clamp(widthRatio, 0.66, 2.35)
  const widthScaledSize = settings.fontSize * clampedScale

  // Preserve peripheral preview lines vertically on short-height banner layouts (e.g., 1280x220)
  const targetMinLines = usableH < 110 ? 2.0 : usableH < 210 ? 3.05 : usableH < 340 ? 3.7 : 4.2
  const autoHeightCap = usableH / (targetMinLines * settings.lineHeight)
  const cappedByAperture = Math.min(widthScaledSize, Math.max(settings.fontSize, autoHeightCap))

  const effectiveFontSize = Math.round(clamp(cappedByAperture, 12, 200))

  // Optical CPL-driven leading compensation (narrow needs tighter, wide > 68 ch benefits from extra breathing)
  const estimatedCpl = Math.max(10, Math.round(constrainedW / (effectiveFontSize * 0.54)))
  let lineHeightAdj = 0
  if (estimatedCpl < 38) {
    lineHeightAdj = -Math.min(0.12, (38 - estimatedCpl) * 0.005)
  } else if (estimatedCpl > 68) {
    lineHeightAdj = Math.min(0.16, (estimatedCpl - 68) * 0.004)
  }
  const effectiveLineHeight = Number(clamp(settings.lineHeight + lineHeightAdj, 1.15, 3.0).toFixed(2))

  // Dark-polarity irradiation compensation (+0.012em micro-tracking when large & neutral user tracking)
  const halationBias =
    darkPolarity && effectiveFontSize >= 20
      ? Number(clamp(effectiveFontSize * 0.01, 0.15, 0.55).toFixed(2))
      : 0
  const effectiveLetterSpacing = Number((settings.letterSpacing + halationBias).toFixed(2))

  return {
    effectiveFontSize,
    effectiveLineHeight,
    effectiveLetterSpacing,
    effectivePaddingX,
    effectivePaddingY,
    estimatedCpl
  }
}

/**
 * Scale RSVP word presentation crisply inside the viewport while guaranteeing
 * the center ORP grid fits horizontally without edge clipping.
 */
export function computeRsvpFontSize(
  stageWidth: number,
  stageHeight: number,
  baseFontSize: number,
  responsiveScale: boolean,
  longestWordChars = 14
): number {
  if (!responsiveScale) return baseFontSize
  const safeW = Math.max(140, stageWidth > 0 ? stageWidth - 32 : 480)
  const safeH = Math.max(60, stageHeight > 0 ? stageHeight - 24 : 260)

  const scale = clamp(Math.pow(safeW / 440, 0.65), 0.72, 2.4)
  const desired = baseFontSize * 1.25 * scale
  const maxByHeight = safeH * 0.56
  const maxByWordWidth = safeW / Math.max(8, longestWordChars * 0.72)

  return Math.round(clamp(Math.min(desired, maxByHeight, maxByWordWidth), 16, 128))
}

