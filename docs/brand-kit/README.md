# Xatu — brand kit and design system

Xatu is a shopping app where small makers in India (home bakers, terracotta and jewellery makers, henna artists, plant nurseries) show their work in photos and reels, and buyers purchase from them with trust. It starts in Trichy.

**The idea behind the brand.** Xatu is a hive for makers: buyers and makers gather in one warm, busy place, and one buyer's good find spreads to the whole neighbourhood. The visual language comes from the hive: the honeycomb cell, honey, the bee's flight path, and the warmth of a crowded, friendly hive.

**Tagline:** Made nearby. Bought with trust.

## Brand personality

| We are | We are not |
| --- | --- |
| Warm and neighbourly, like a maker's front room | Cold marketplace, "SKU" language |
| Proud of handmade | Flashy, discount-driven, urgent |
| Plain-spoken in Tamil and English | Jargon, English-only, fine print |
| Trustworthy, open about money | Hidden charges, vague policies |

## Voice and writing

- Lead with the maker and the thing: "Kayal's terracotta lamps", not "Product #2231".
- Short sentences. Verb-first buttons, sentence case: "Buy now", "Book pickup", "Post reel".
- Say what happens to money, every time: "Your money stays safe with Xatu until you get your order."
- No exclamation marks in system messages, no emoji in UI text, no "Hurry!" or countdowns.
- Every string ships in Tamil and English. Tamil copy is written by a native speaker on the team, not machine-translated. Tamil runs about 30% longer, so give every label room to grow.

## Colour

A soft, warm palette: Ivory and Champagne grounds, Plum Ink text, Dusty Rose as the brand, Marigold for action, and Sage Green kept for trust. Each colour has one job, so buyers learn what it means.

| Token | Colour | Role and rule |
| --- | --- | --- |
| `surface` / `surface-warm` | Ivory #FCF8F1 / Champagne #F4E6CF | Page and warm panels. |
| `ink` | Plum Ink #3A2230 | All text. Also the text colour on every coloured fill (rose, blush, marigold, gold). |
| `brand-fill` + `on-brand` | Dusty Rose #C98A96 | The brand: big fills, avatar rings, cover blocks. Text on it is Plum, never Ivory (Ivory fails contrast). |
| `brand` | Deep rose #9A4E5E | Brand as text and icons: links, active tab. Never on Blush. |
| `blush` | Blush #EBCFD0 | Soft backgrounds: selected chips, product tag pills. |
| `plum` + `on-plum` | Plum #3A2230 + Ivory | Dark surfaces: welcome hero, pickup code card. |
| `marigold` + `on-marigold` | Marigold #E3A62F + Plum | The only action colour. One marigold button per screen. |
| `sage` / `sage-soft` | Sage Green #4E6B4C / #E2EADB | Trust only: verified badge, Protected Pay, delivered. |
| `gold` / `gold-text` | Antique Gold #C29A62 / #7A5826 | Handmade and maker highlights. |
| `taupe`, `line` | Soft Taupe #BFB3AA, #E8DCD3 | Dividers, disabled states, neutrals. Never text on light. |

Every text token passes 4.5:1 on the grounds its note names, in light and dark. Ivory on Dusty Rose (2.6:1) and deep rose on Blush (4.0:1) fail, so they are banned pairs.

## Type

- **Fraunces** (display: names, prices, titles): a warm, soft serif that matches the palette. Tamil headings fall back to **Noto Serif Tamil**, so both scripts share a serif feel.
- **Hind Madurai** (text): designed for Tamil and Latin together, very readable at small sizes on low-end screens. Falls back to Noto Sans Tamil.
- All are free Google Fonts. Bundle them in the app (Expo `expo-font`) so they work offline.
- Scale: `display` 32, `title` 22, `price` 18, `heading` 17, `body` 15, `label` 13, `caption` 12. Never below 12px. Respect the phone's text-size setting.

## Space, shape, depth

- 4px base: `space-1` 4 · `space-2` 8 · `space-3` 12 · `space-4` 16 (screen margin) · `space-6` 24 (between sections) · `space-8` 32.
- Corners are soft: `radius-sm` 8 (tags), `radius-md` 14 (buttons, inputs, cards), `radius-lg` 22 (sheets, post media), `radius-pill` (chips, trust badge).
- One shadow, `shadow-card`, for floating things (the Buy bar, sheets). Everything else is flat on `line` borders.
- Touch targets at least 48 × 48 px. The bottom tab bar is 64px tall plus the safe area.

## Iconography

Lucide icons at 1.75 stroke for everything generic, plus six Xatu icons in `assets/Icons` for trust and buying (verified, protected pay, near me, pickup slot, captured in app, delivery OTP). Icons are always paired with a word on first use; trust icons are always `sage`.

## Core components (built in the app, described here)

- **Buy button**: full-width, `marigold` fill, `on-marigold` (Plum) label, `radius-md`, 52px tall, in a floating bar with the price on the left.
- **Product tag**: a `surface-raised` pill on a post photo with the product name and price in Plum; tapping opens the product sheet.
- **Trust badge**: `sage-soft` pill with the verified icon and "Verified maker" in `sage`. Show factual badges (verified, purchase-verified reviews, deliveries) before any numeric score.
- **Protected Pay banner**: `sage-soft` card with the shield icon. Wording must match the payment flow Razorpay and your lawyer confirm; do not call it escrow.
- **Post card**: maker avatar (Dusty Rose ring), name, trust badge, place; 4:5 media with `radius-lg`; actions row; product tags.
- **Filter chip**: `radius-pill`, `line` border; selected = `blush` fill + `brand-fill` border + Plum text.
- **Tab bar**: Home, Discover, Create (marigold hive button), Orders, Profile; active = `brand`, inactive = `ink-muted`.

## Logo

See `assets/Logos/README.md`. The mark is a marigold hive cell with a plum flight path; the dot is the bee. Wordmark is lowercase **xatu** in Fraunces Bold.

## Using this system

Colours are semantic tokens with a Light and a Dark theme (Light first). Reference tokens by name in code (`theme.colors.marigold`, `theme.space[4]`); never paste hex values into screens. Dark mode follows the phone setting.
