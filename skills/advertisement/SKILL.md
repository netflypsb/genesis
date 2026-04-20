---
name: advertisement
description: "Create professional advertisements (digital display, social media, print, banner) using HTML/CSS and Puppeteer PNG/PDF conversion. Supports IAB standard sizes, social media dimensions, and print formats. Use when user asks to create an ad, advertisement, banner, display ad, social media ad, or marketing creative."
group: creative
---

# Advertisement Skill

Create professional advertisements using HTML/CSS converted to PNG (digital) or PDF (print) via Puppeteer.

## Quick Reference

| Task | Method |
|------|--------|
| Create advertisement | Follow workflow below |
| Output format | HTML → PNG (digital) or PDF (print) via Puppeteer |
| Supported types | Display ads, social media ads, print ads, banner ads |

## Advertisement Types

### Digital Display Ads (IAB Standard Sizes)
| Name | Dimensions | Use |
|------|-----------|-----|
| **Medium Rectangle** | 300×250 | Most common, in-content |
| **Leaderboard** | 728×90 | Top of page |
| **Wide Skyscraper** | 160×600 | Sidebar |
| **Half Page** | 300×600 | High impact sidebar |
| **Large Rectangle** | 336×280 | In-content |
| **Billboard** | 970×250 | Premium top placement |
| **Mobile Banner** | 320×50 | Mobile top/bottom |
| **Mobile Interstitial** | 320×480 | Full-screen mobile |

### Social Media Ads
| Platform | Dimensions | Aspect Ratio |
|----------|-----------|-------------|
| **Instagram Post** | 1080×1080 | 1:1 |
| **Instagram Story/Reel** | 1080×1920 | 9:16 |
| **Facebook Feed** | 1200×628 | ~1.91:1 |
| **Facebook Story** | 1080×1920 | 9:16 |
| **LinkedIn Sponsored** | 1200×627 | ~1.91:1 |
| **Twitter/X** | 1200×675 | 16:9 |
| **Pinterest Pin** | 1000×1500 | 2:3 |
| **YouTube Thumbnail** | 1280×720 | 16:9 |
| **TikTok** | 1080×1920 | 9:16 |

### Print Ads
| Type | Dimensions | Notes |
|------|-----------|-------|
| **Full Page A4** | 210×297mm | Magazine/newspaper |
| **Half Page A4** | 210×148.5mm | Horizontal |
| **Quarter Page A4** | 105×148.5mm | Small placement |
| **US Letter** | 8.5×11" | US standard |

## Design Principles

### The AIDA Framework
1. **Attention**: Bold headline, striking visual, or surprising element
2. **Interest**: Engaging subheadline or supporting visual
3. **Desire**: Benefits, social proof, emotional appeal
4. **Action**: Clear, compelling CTA

### Key Rules
- **ONE clear message** per ad — if you can't say it in 5 words, simplify
- **3-second rule**: Core message must be understood in 3 seconds
- **CTA prominence**: The call-to-action must be the most actionable element
- **Brand visibility**: Logo/brand name always visible but not dominant
- **High contrast**: Text must be readable against any background
- **Minimal text**: Especially for social media (Facebook's 20% text guideline)
- **Visual hierarchy**: Headline > Visual > CTA > Supporting details

### Typography for Ads
- **Headline**: Bold, 24-48pt (scales with ad size) — maximum 5-7 words
- **Subheadline**: Medium, 14-20pt — maximum 10-15 words
- **Body**: Regular, 10-14pt — use very sparingly (max 20 words)
- **CTA**: Bold, 16-24pt, high contrast button/badge — 2-4 words
- Maximum 2 font families per ad

### Color Psychology for Advertising
| Color | Association | Best For |
|-------|------------|----------|
| **Red** | Urgency, excitement, passion | Sales, clearance, food, entertainment |
| **Blue** | Trust, reliability, calm | Finance, tech, healthcare, corporate |
| **Green** | Growth, health, nature | Eco products, wellness, finance |
| **Orange** | Energy, enthusiasm, warmth | CTAs, youth brands, food |
| **Purple** | Luxury, creativity, wisdom | Premium products, beauty |
| **Black** | Sophistication, power | Luxury, fashion, tech |
| **Yellow** | Optimism, attention, warmth | Warnings, highlights, youth |
| **White** | Clean, minimal, pure | Healthcare, tech, premium |

### CTA Best Practices
- Use action verbs: "Shop Now", "Get Started", "Learn More", "Try Free"
- Create urgency: "Limited Time", "Last Chance", "Today Only"
- Be specific: "Save 30%" beats "Save Money"
- Button style: Rounded corners, contrasting color, sufficient padding
- Position: Bottom-right or center-bottom for most layouts

## Workflow

### Step 1: Gather Requirements

Use **AskUserQuestion** to clarify:
1. **Ad type**: Digital display, social media, print, or banner?
2. **Platform**: Google Display, Facebook, Instagram, LinkedIn, print publication?
3. **Dimensions**: Standard size or custom? (suggest IAB/platform standards)
4. **Product/service**: What is being advertised?
5. **Key message**: What is the single most important thing to communicate?
6. **CTA**: What should the viewer do? (e.g., "Shop Now", "Learn More")
7. **Brand assets**: Logo description, brand colors, fonts, guidelines?
8. **Style**: Minimal, bold, elegant, playful, corporate, dark, vibrant?
9. **Output**: PNG (digital) or PDF (print)?

### Step 1.5: Generate Visual Assets (Optional — Requires Human Approval)

If the ad benefits from custom imagery:

1. **Ask the user first** via AskUserQuestion — confirm which visuals to generate
2. Generate images with appropriate settings:
   - **Hero product shot**: `generate_image(prompt="...", model="flux-pro", aspect_ratio="1:1", save_path="advertisement/{topic-slug}/images/hero.png")`
   - **Background visual**: `generate_image(prompt="...", aspect_ratio="16:9", save_path="advertisement/{topic-slug}/images/bg.png")`
3. Each `generate_image` call requires human approval at execution time
4. Reference in HTML: `<img src="./images/hero.png" style="width: 100%; object-fit: cover;" />`

**Prompt tips for advertisement images:**
- Product ads: "clean product photography, studio lighting, white background, commercial quality"
- Lifestyle ads: describe the scene, mood, and demographic matching the target audience
- Backgrounds: "abstract gradient", "soft bokeh", "textured surface" for non-distracting backgrounds
- Brand consistency: include brand colors and style keywords in the prompt

### Step 2: Construct Ad Content

Build the ad copy following AIDA:
- **Headline**: Max 5-7 words, bold and attention-grabbing
- **Subheadline**: Max 10-15 words, supporting the headline
- **Body text**: Optional, max 20 words (skip for small ad sizes)
- **CTA text**: 2-4 words, action-oriented
- **Visual element**: Hero image, product shot, or illustration description

### Step 3: Generate HTML

Create a self-contained HTML file:

**Critical Rules:**
- Single HTML file with ALL CSS inline (no external dependencies)
- Set exact pixel dimensions matching the target ad size
- Use CSS Flexbox or Grid for layout
- High contrast between text and background (minimum 4.5:1 ratio)
- Include brand colors as CSS custom properties
- Font loading via Google Fonts `<link>` tag
- All spacing in pixels for exact placement
- CTA button with clear hover/active states (for reference)

**HTML Template Structure:**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: [AD_WIDTH]px;
      height: [AD_HEIGHT]px;
      overflow: hidden;
      font-family: 'Inter', sans-serif;
    }
    .ad-container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: [scaled padding];
      background: [brand color or gradient];
      position: relative;
    }
    .headline {
      font-size: [scaled]px;
      font-weight: 900;
      line-height: 1.1;
      color: [contrast color];
    }
    .cta-button {
      display: inline-block;
      background: [accent color];
      color: white;
      padding: [scaled]px [scaled]px;
      border-radius: 8px;
      font-weight: 700;
      font-size: [scaled]px;
      text-align: center;
    }
    .logo {
      position: absolute;
      bottom: [scaled]px;
      right: [scaled]px;
    }
  </style>
</head>
<body>
  <div class="ad-container">
    <!-- Background image if applicable -->
    <div class="content">
      <h1 class="headline">[HEADLINE]</h1>
      <p class="subheadline">[SUBHEADLINE]</p>
    </div>
    <div class="cta-section">
      <span class="cta-button">[CTA TEXT]</span>
    </div>
    <div class="logo">[BRAND LOGO/NAME]</div>
  </div>
</body>
</html>
```

**Scaling Guidelines:**
| Ad Width | Headline Font | CTA Font | Padding |
|----------|--------------|----------|---------|
| 300px | 22-28px | 14-16px | 16-20px |
| 728px | 32-40px | 16-20px | 24-32px |
| 1080px | 42-56px | 20-28px | 32-48px |
| 1200px | 48-64px | 24-32px | 40-56px |

Save to `advertisement/{topic-slug}/ad.html`.

### Step 4: Render to PNG/PDF

**For digital ads (PNG):**
```javascript
const puppeteer = require('puppeteer');
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setViewport({ width: AD_WIDTH, height: AD_HEIGHT });
await page.goto(`file://${absolutePath}/ad.html`, { waitUntil: 'networkidle0' });
await page.screenshot({
  path: 'ad.png',
  type: 'png',
  clip: { x: 0, y: 0, width: AD_WIDTH, height: AD_HEIGHT }
});
await browser.close();
```

**For print ads (PDF):**
```javascript
await page.pdf({
  path: 'ad.pdf',
  width: `${AD_WIDTH}px`,
  height: `${AD_HEIGHT}px`,
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 }
});
```

Save to `advertisement/{topic-slug}/ad.png` or `ad.pdf`.

### Step 5: Output Summary

```
Advertisement Created!
- Type: [Digital Display / Social Media / Print]
- Platform: [Target platform]
- Dimensions: [width]×[height]px
- Files:
  - advertisement/{topic-slug}/ad.html (source)
  - advertisement/{topic-slug}/ad.png (output)
  - advertisement/{topic-slug}/images/ (generated assets, if any)
```

## Quality Checklist
- [ ] Message communicable in 3 seconds (AIDA: Attention)
- [ ] CTA is clear, prominent, and actionable
- [ ] Brand identity (logo/name) is visible
- [ ] Text is readable at actual display size
- [ ] Color contrast meets accessibility standards (4.5:1 minimum)
- [ ] Correct dimensions for target platform
- [ ] No text overflow or clipping
- [ ] Visual hierarchy: Headline > Visual > CTA > Details
- [ ] Maximum 2 font families used
- [ ] Headline ≤ 7 words, CTA ≤ 4 words
