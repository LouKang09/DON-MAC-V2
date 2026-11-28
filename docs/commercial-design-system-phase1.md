# Don Mac POS commercial design system — Phase 1

**Scope:** Main POS, Android WebView, mobile browser, Supply Chain Office and Admin Control. The shared stylesheet is `public/donmac-design-system-v1.css`. Each HTML entry point loads it once after its existing styles. The Android app receives the same web stylesheet; no native build is required.

## Tokens and components

| Token group | Standard |
| --- | --- |
| Primary / accent | #095b3d / #168154 |
| Navigation / active | #172820 / #24583d |
| Workspace / surface | #f5f7f5 / #ffffff |
| Text / muted | #172c22 / #536b5e |
| Danger / warning | #b32e38 / #946216 |
| Spacing | 4, 8, 12, 16, 20, 24 CSS px equivalents, expressed in rem |
| Type | system font stack; 11, 13, 14, 18, 22 px equivalents |
| Radius | 14px card, 10px control, full pill |
| Regular control | 40px nominal; mobile exceptions permitted |
| Icons | 18px nominal; preserve native SVG/lottie and feature-specific sizes |
| Motion | 160ms transitions; respect reduced-motion preference |

## Rules

- Keep the coffee illustration in authentication, not the operational workspace.
- Use existing semantic primary/secondary buttons and shared confirmation dialog classes.
- Use pill shapes for single-line fields and text actions; retain rounded squares for icon-only controls and existing quantity entry.
- Preserve labels, accessibility focus, validation, destructive colors, role restrictions, and scrollable table wrappers. Never style hidden permissions into view.
- Use rem and fluid widths, not physical device pixels. Do not change root font size.
- Do not put feature layout overrides or arbitrary per-page dimensions in this shared file. When a screen requires tighter sizing, use its feature stylesheet.
- Adopt the token names for new screens; migrate legacy important declarations in Phase 2 one screen at a time rather than force a blanket override.
- Existing specialized login, checkout, status badges, chart, mobile controls, dialogs and native Android behavior remain intact.

## Integration and QA

Phase 1 is a CSS-only foundational change. Confirm the three entry points load the same stylesheet and verify role visibility and login screen are unchanged. Compare the main workspace, Supply Chain and Admin Control at mobile (360/390 CSS px), tablet portrait/landscape and desktop. Check checkout controls, attendance, report tables, scroll, disabled controls, and prompt danger states. Authenticated and real-device visual QA remains required before declaring the entire redesign complete.

## Rollback

Use the pre-commercial backup branch to compare or revert the integration commit. No migrations, account settings, transaction or inventory changes are part of this phase.
