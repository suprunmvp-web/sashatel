# SashaTel — Design Standard for GPT and UI Engineers
Version: 1.1 · Brand owner: ООО «Полезный звонок» · Product: SashaTel  
**Status:** design language approved; numeric token values are implementation baseline subject to QA. Desktop softphone layout **not approved**. Reference-traced vector is **not the original logo**.

## 0. How an AI agent must use this document

This is a decision contract, not a mood board. Read in this order:
1. Understand which product surface the user is modifying and the task of its real operator.
2. Preserve existing product behavior, navigation, domain terms, metrics and data flows.
3. Apply the hierarchy, spacing, typography, color, icon and motion rules here.
4. Verify the resulting screen in the browser, including narrow and intermediate widths.
5. Report test evidence and explicitly label unresolved decisions. Never claim approval based only on code generation.

**Source precedence:** user-approved screens and business functionality → this standard → product source code and UX/UI skill evidence → optional visual references. If one conflicts with another, ask only where necessary; otherwise prefer function, accessibility and tested behavior over decoration.

Use the user's UX/UI skill `ux-ui/SKILL.md` as a **method**: inspect surface and task; search the relevant UX catalogs, not whole datasets; apply suitable findings; verify in actual viewport. The skill never overrides SashaTel identity. Searching the skill is not a substitute for testing.

### Required AI output before implementation
For nontrivial new UI, briefly state: (a) user's goal, (b) layout and interaction contract, (c) exact tokens/components reused, (d) states and breakpoint plan. Then implement and test. Do not create speculative features or redesign adjacent modules without authorization.

## 1. Philosophy — Quiet Technology

SashaTel is independent professional telephony, not SashaAI with a new icon. Its users work with calls, numbers, conversations and operational decisions under time pressure. **Complexity belongs to the system, not to the person using it.**

The face of SashaTel should evoke Linear's editorial precision, not copy Linear's code or distinctive assets. shadcn/ui is a reference for comprehensible control anatomy, not a mandate for a card grid. Apple Watch pairing informs the *feel* of particle motion, not an asset to reproduce.

- **Calmness:** a stable canvas, restrained contrast, rare motion. Primary content is always easiest to find.
- **Precision:** consistent baselines, spacing, character sizes, tabular numeric alignment and stable controls.
- **Speed:** common actions require fewer steps; don't bury the dial, history or connection status in decoration.
- **Confidence:** statuses describe real conditions; never imply that internet, audio, conversion or payments are healthy without measured data.
- **Restraint:** remove elements until each remaining one has a clear purpose. Space often groups better than a border.

**Anti-patterns:** AI-generated tiled dashboards; many bordered cards as a universal layout; glowy KPI blocks; gradients on controls; heavy shadows; gratuitous glass effects; unrelated icons; colored financial arrows; random yellow stains; emoji as UI icons; multiple simultaneous audio visualizers; particle decorations behind analytical content.

## 2. Brand architecture and assets

Public name: **SashaTel**. Legal entity: **ООО «Полезный звонок»**. Organization name in the demo workspace is also ООО «Полезный звонок». Use organization switcher top-left in cabinet; user profile top-right. Do not place a manager's personal avatar in the sidebar as organizational identity.

### Logo
**Non-negotiable lockup rule:** NEVER display the SashaTel symbol directly beside, above as a unit, or appended to the word “SashaTel” in a single header/footer/CTA lockup. Use **either** the standalone symbol **or** the standalone SashaTel wordmark. The brandbook may show both only as distinct independent examples with clear whitespace. Do not overlay or merge them, even if a reference mockup happens to do so.

The original master SVG is required for production. Until delivered, `assets/logo-reference-trace.svg` is a **provisional visual trace made from the user's raster**, not an approved master. It is included solely so agents see the approximate silhouette. No generative reinterpretation, rotation, gradient, interior pattern, stretching, added text or 'enhancement' is allowed. Use positive/negative monochrome only, preserve native aspect ratio and clear space ≥ 0.5× sign height. Do not blindly rasterize the source. Replace this file as soon as the real vector is supplied; do not silently promote the trace to production.

## 3. Color semantics

**95% neutral / 5% signal yellow** describes visual attention, not literal screen area or the proportions of analytic data.

| Semantic token | Dark value | Purpose |
|---|---|---|
| `--bg` | `#0B0B0D` | primary canvas |
| `--surface` | `#151518` | functional elevation only |
| `--hover` | `#202024` | hover/selected subtle surface |
| `--line` | `#29292F` | 1px separators and outlines |
| `--fg` | `#F5F5F7` | primary content |
| `--sub` | `#92929B` | metadata |
| `--dim` | `#63636B` | low-priority labels, not critical actions |
| `--accent` | `#E8C547` | singular focus / active status |
| `--accent-mid` | `#C9A227` | luminous field secondary yellow |
| `--accent-deep` | `#8E7426` | luminous field tertiary yellow |

Do not make every call-to-action yellow. A white CTA can be the strongest CTA; yellow often marks a small selected indicator. Functional semantic danger (e.g. hangup) can be red; connectivity/availability may use constrained accessible status colors when based on real measurement. The 95/5 rule never forbids functional error signaling.

**Donut charts:** data angles must correspond to real values. Do NOT force one result into a 5% arc when its real value is 42.8%. Use neutral segment fills and a small yellow selection marker / legend dot instead.

## 4. Typography and geometry

Primary `Geist` (variable where supported), fallback system sans. Numeric/technical `Geist Mono`; use tabular numerals for call duration, totals and tables.

- Page title 28–36px / 500; section 18–22px / 500; body 14–16px / 400; supporting 12–13px / 400; big KPI 30–34px / 500.
- Hero headings scale responsively via `clamp()`, but must not swallow controls on small screens.
- Default line height: body 1.45–1.6, display 1.06–1.15. Avoid aggressive letterspacing for Cyrillic.
- Base spacing: 4px. Approved sequence 4, 8, 12, 16, 24, 32, 40, 48, 64px.
- Functional controls: 32px compact, 36–40px standard; mobile interactive hit target preferably ≥44×44 CSS px, even when visible glyphs are smaller.
- Borders 1px; radii 4–8px, larger only for clearly intentional device windows / overlays. Never round every surface into a pill.
- Use a grid or flex for structure; forbid positioning entire content layouts with unexplained absolute coordinates. Avoid `width: 100vw` nested in padded content, which can cause overflow.
- Rows and groups require stable alignment; labels align to a baseline; numeric columns right-align.

**Layout first:** sketch semantic hierarchy (sidebar, utilities, title, KPI, chart, detail) before drawing rectangles. Keep one dominant content plane; use thin separators between logically related sections. Create a card only for independently interactive/scrollable content that truly needs boundaries.

## 5. Icon registry

Use **Lucide**, pinned to `0.456.0`, with icon names drawn only from `icon-registry.json`.
- Standard 18px; compact 16px; highlighted 20px.
- Default stroke 1.75px, round line caps/joins, fill none.
- The same action always uses the same icon and accessible label.
- For icon-only navigation, require tooltip / accessible name and obvious selected-state cue.
- Do not use Unicode surrogate icons such as `⌂`, `♧`, `♙`, emoji or AI-sketched variants.
- A new icon requires an explicit addition to registry with meaning and contexts.
- Call status icon is not decorative. Connection quality must distinguish good, degrading, and disconnected from measured data.

Approval vocabulary (selected): `phone`, `phone-call`, `phone-off`, `history`, `settings`, `wifi`, `wifi-off`, `mic`, `mic-off`, `pause`, `grid-3x3`, `ellipsis`, `search`, `bell`, `chevron-down`, `layout-dashboard`, `chart-no-axes-column`, `users`, `contact`, `layers`, `plug`, `circle-help`, `arrow-right`, `download`, `copy`.

### Yellow status glow
Small yellow activity indicators may have a deliberately subtle, **asynchronous** halo/breathing pulse: diffuse radius 6–18px, low opacity, irregular phase offsets for neighboring dots. Never animate all yellow indicators in sync; do not create large neon blobs. The dot remains informative without motion. Under `prefers-reduced-motion`, remove all pulsing, retaining the state color and accessible label. Do not use decorative yellow glow to imply healthy network or activity without a real corresponding state.

## 6. Particle Field — SashaTel digital matter

This is the brand's **one** bespoke audio-inspired visual language. It must be implemented as many micro-particles in a coherent field, not a SoundCloud bar chart and not a plastic illuminated sphere.

### Material palette and density
- Around 70% soft white/gray, 25% graphite, 5% yellow (`#E8C547`, `#C9A227`, `#8E7426`).
- Particle diameters nominally 0.8–2.2px, opacity 0.15–0.65, variable depth.
- Faint local **glow clusters** may move independently; no permanent neon halo, no blurred text, no glowing UI borders.
- Slow background loops have no obvious reset. Prefer deterministic periodic phase functions over periodically re-sampling random particles.
- Use `requestAnimationFrame` at native display refresh and profile CPU/GPU cost. Never promise guaranteed 60fps across devices.

### Allowed states
**Landing / distant signal:** elongated, atmospheric field; low opacity; slow wandering deformation; yellow rare. It must not compete with headlines or controls.

**Call / listening or speaking:** particles **morph into an irregular living ring** around a calm center; transition is spatially coherent (no particle teleportation); the same particles react to voice energy and cadence with local microbursts and transient glows. Do not grow and shrink the *entire* field monotonically with volume. Prefer a fast attack and slower release and locally stochastic/timbre-like spatial motion; retain legible caller text. No second bar waveform.

**Connecting:** restrained assembling motion; once connected, move to audio-reactive state. Note that current website illustrates a demo transition; full call-state integration is not yet product-approved.

**Reduced motion:** static representative shape with retained semantic state; never require animation to convey signal health.

**Forbidden:** analytics, donut charts, KPIs, dense tables, settings forms, every sidebar item, loading spinners without a product reason, or multiple different waveform treatments on one screen.

### Real audio integration contract
The site demo synthesizes uneven 'syllable' events: it is not a recording or real microphone input. The real softphone must supply an existing authorized `MediaStream` to `SashaTelParticle.attachAudioStream(stream)`; `detachAudioStream()` on end. Never request microphone permission merely for brandbook decoration. Do not record/store audio in the visualizer. React to measured RMS level and attack transients, not fictional sound health.

## 7. Screen contracts

### Landing
Navigation → generous headline and short value statement → one obvious CTA → understated product preview. Particle Field stays behind negative space. Never put the full dashboard in the hero. At 390px, text and controls must wrap/stack without horizontal scrolling.

### Organization workspace
Top-left = organization switcher; top-right = notifications, theme, date range, account profile. Sidebar nav = Overview, Statistics, Calls, Contacts, Team, Scenarios, Integrations, Settings. No personal user image near organization name. Navigation is plain text/icon rows, with *one* selected surface + narrow yellow marker.

### Statistics
Preserve functional hierarchy: title, subheading, four horizontally aligned KPIs, answer-rate-over-time line chart, call-outcome donut/legend, operator breakdown table. Demo KPI: **+14 320** call attempts, **42.8%** connection, **02:34** average talk, **+36 982** minutes. The + is part of the agreed demo presentation, not a claim that the underlying raw count is a positive financial delta. Live product must follow correct metric semantics.

Chart default: 1.5–2px neutral line; hover/focus: small yellow marker, vertical guide, concise date/value tooltip. Animate state changes but not endlessly pulsing data. Donut segments convey actual values; one accent can indicate focus.

### Desktop softphone
**UX not approved.** Do not use old generated mockups as source of truth. Build only when information architecture, actual dimensions, call states and controls are agreed. Baseline operator need: fast dialing, history/settings outside an active call, network quality visible, audio device and mute reliable, active call prioritizes name/timer/actions. Use existing Electron/telephony requirements, not marketing-screen aesthetics.

## 8. Interaction, accessibility, responsive

- Hover 120–160ms; state transitions 160–220ms; chart transitions 300–500ms; particle shape transition may be slower and physically smooth.
- Every interactive element has keyboard focus, Enter/Space where appropriate, meaningful label, disabled/loading/error state, visible focus ring.
- Respect `prefers-reduced-motion`, contrast and real language lengths. Icons alone never replace accessibility labels.
- Validate 1440 / 1280 / 1024 / 768 / 390px and actual component dimensions; watch Cyrillic labels for clipping.
- Build tables with horizontal scroll or responsive column prioritization, not illegible shrink-to-fit text.
- Avoid false status indicators, arbitrary placeholder people, claims of deployment, and implicit production readiness.

## 9. Definition of Done / AI self-audit

Before publishing:
- [ ] Function and user journey preserved; no invented workflow.
- [ ] Existing approved logo asset reused; if unavailable, explicitly label placeholder.
- [ ] Approved palette and Geist applied consistently.
- [ ] Exactly one accent focal point per local composition.
- [ ] Layout groups by spacing before boxes; no card puzzle.
- [ ] All icons belong to registry and are SVG/Lucide, not text glyphs.
- [ ] No horizontal overflow at test widths; no clipped Cyrillic text or misaligned baselines.
- [ ] Hover, focus, keyboard, empty, error, loading and selected states checked.
- [ ] Particle Field occurs only in permitted contexts, with reduced-motion fallback.
- [ ] Graph values are not altered to match visual proportions.
- [ ] Console has no errors; interactions checked in a real browser.
- [ ] Screenshots compared against approved reference at 100% scale.
- [ ] Git commit includes changed source assets and documentation; production URL checked after deploy if available.

If any criterion fails, report it as unfinished. Never call a generated mockup '10/10' or claim it was visually tested without evidence.

## 10. Change management

- All new visual decisions must update this file and relevant component/source tokens together.
- New icons require `icon-registry.json` updates and explicit justification.
- New Particle Field modes require a purpose, performance budget, and screenshot/animation review.
- Archive deprecated mockups; they are **not** allowed precedents.
- Repo: `suprunmvp-web/sashatel`, brandbook at `brandbook/`. Vercel project should use that root; don't overwrite the existing production `/index.html`.


## 11. Product refinements — interactive demo reference (2026-11-16)

**Light/dark themes:** Both themes must use semantic tokens, not CSS inversions of screenshots. Neutral base shifts from graphite to off-white; yellow remains a sparse action/focus signal with adjusted contrast; red and green are reserved for semantically meaningful call events, logs, incident states and measured trends. Theme toggling is demonstrable in the HTML brandbook and its choice is persisted for subsequent visits. Do not assume the core telephony product has adopted the light theme until approved.

| Semantic event token | Dark | Light | Meaning |
|---|---|---|---|
| `--success` | `#39C985` | `#168353` | call completed, verified successful operation, positive real delta |
| `--danger` | `#E86A71` | `#BD3647` | failed attempt, hangup destructive action, SIP error |
| `--warning` | `#E8C547` | `#A27A17` | caution / attention needed, never an unverified positive state |

**Organization sidebar:** When expanded, show the organization header above a separator and labeled navigation rows. When collapsed, show its monogram and accessible icon-only navigation; provide a visible panel-left toggle at the end of the organization header with an accessible name, pressed state and tooltip. The minimized state persists in the demo. Keep the organization title and subtitle to one line each with ellipsis, reserve fixed width for the avatar and toggle, and expose the full name on hover and to assistive technology. Collapsing must not alter main content geometry unexpectedly, hide the ability to reopen the menu, or imply an entirely different product.

**Phone signal:** Never substitute a Wi‑Fi arcs icon for call/network quality. Use a cellular/signal-level bar icon (`signal`). The count/opacity of bars must represent a measured value in production. Distinguish connection available from RTP/audio quality when both are shown; do not assume good audio from mere network connectivity.

**Date-range selector:** Format compact Russian ranges as `4 окт — 17 окт 2026`. Values displayed in the date selector must actually be the selected range. In an HTML demonstration, changing the selector may update the label while the mock statistics remain static, but a visible note must disclose that. Production must refetch/aggregate for that selected period and handle incomplete/empty ranges.

**Stats navigation and icon mapping (reference):** `activity` Statistics, `server` Trunks, `phone` History of calls, `plug` Integrations, `settings` Settings, `credit-card` Billing. No duplicated placeholder glyphs; icons must be applied from the approved registry.

**Donut behavior:** Adapted from the original product's SVG donut, not a static CSS ring. Segment angle reflects real percentages. Each segment can be hovered or keyboard-focused to emphasize that segment and update the center value and matching legend row; dim the others. No extra yellow stroke draped on top. Red and yellow may color actual categories where semantically justified, but never distort category areas.

**Notification bell:** It has a fixed icon-button hit box, correct centered icon alignment, and a small separate dot for unread activity. If the dot pulses, its glow is subtle and respects reduced motion. Do not use the glowing yellow as an actual notification indicator when the inbox has no unread state.

**Quality gate:** Test expanded/collapsed sidebar, light/dark theme, notification alignment, date popover open/close/keyboard behavior and donut hover/focus in a real browser before claiming production readiness.


## 12. macOS first launch and softphone

**Platform chrome:** Use native macOS title-bar controls in production. The reference HTML shows the three colored controls in their close/minimize/zoom order, at 12 CSS px with 8 px separation. The brandbook simulates the product window and does not change operating-system state.

**First-run sequence:** Keep window controls over the scene. Present login and password inside the window. Use Georgia Regular and Italic for first-run display text, Geist for labels and controls, and Geist Mono for the timer. The field gathers as the form opens and brightens while the line connects. Production must validate credentials and show an actionable sign-in error in place. The HTML walkthrough processes fields locally, clears them on submit, and offers a demo entry. No credential is sent or stored.

**References:** [Zen](https://zen-browser.app/) informs the restrained editorial welcome, with serif typography limited to first run. [Apple Watch setup](https://support.apple.com/en-us/109015) informs the visible connection moment and a clear alternative when the first path fails. [macOS Tahoe](https://support.apple.com/en-us/122868) informs depth and window materials. [ChatGPT](https://help.openai.com/en/articles/20001276-moving-to-the-new-chatgpt-desktop-app) informs the open-to-sign-in sequence. [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui) informs the working dialer's hierarchy. [Screen Studio](https://screen.studio/) informs transitions that direct attention. SashaTel uses its own mark and particles throughout.

**Desktop motion:** The site field is a continuous waveform and call ring. First run uses a softly lit rotating volume. Widely dispersed particles converge for roughly 1.65 seconds, then drift during sign-in. The telephony handshake receives one brief acceleration and warm glow before Ready. Use a diagonal mask to reveal the display headlines. Keep text real and selectable. Reduced motion renders a still volume, shows headings immediately, and shortens simulated waits. The working dialer uses Geist and short press feedback.

**Product scope:** SashaTel Desktop is a compact tool for B2B outbound calls. Keep analytics, billing, CRM, employee administration and trunk settings in the web products. The production shell opens on Phone. Its bottom navigation contains Phone, History and Settings. The HTML reference window is 376 × 566 CSS px, with a narrow layout checked separately. Keep navigation visible when telephony is unavailable and hide it while a call is in progress or awaiting confirmation.

**Dialing:** The empty field has a format example and the action is disabled. Accept ten national digits, eleven digits starting with 8, or an international +7 number, including pasted spacing and punctuation. Canonicalize to +7 plus ten digits. The keypad follows the approved 1–9 / +, 0, delete arrangement, with small letter groups from the functional brief. Separate clear-all from backspace. Backspace removes the selection or preceding character. Enter and «Позвонить» invoke the same command. The action requires a valid number, confirmed telephony availability and no outstanding call. Guard against duplicate commands at the UI and telephony boundaries.

**Connection and call lifecycle:** Show «Свободен» / «Занят» separately from service connectivity («Подключено», «Подключение», «Нет соединения»). The connectivity source is telephony, not generic internet reachability. Progress is «Соединяем…» → «Идут гудки…» → «Разговор». Show the timer only after confirmed answer, using the telephony start time. «Завершить» cancels an unanswered call or ends an active conversation. Disable it while «Завершаем звонок…» and keep new calls blocked until confirmation. After confirmation show «Звонок завершён» or «Вызов отменён» and return to the dialer. For «Не удалось соединиться», show the known reason and a route back. On renderer restart, query telephony for the current call, including any pending termination and confirmed answer timestamp, before enabling the dialer. Hide mute, audio switching, hold and DTMF from the MVP specimen. Escalate additions to the product team before designing them into the primary flow.

**History:** Every outbound row shows number, local date/time, result and confirmed duration where applicable. Use «Отвечен», «Без ответа», «Отменён», «Ошибка» and «Не определён» as distinct outcomes. «Повторить» copies the number into Phone and waits for the user to initiate the call. «Обновить» refetches history. Design loading, empty, error and retry. The production source is persistent server history. The HTML example uses local fixtures and adds results for the current session.

**Settings:** Show device selectors for input and output and the application volume control. During microphone testing show a meter driven by measured input and the detected/no-signal result, plus a stop action. Explain denied permission, missing devices and disconnected headsets. Output testing provides play/stop and asks whether the signal was heard. When routing is controlled by macOS, disable the selector and explain where to set it. Store Light, Dark and System preferences and follow OS changes in System mode. The About block shows the mark, name, actual application version and application connectivity. Browser demo controls sit outside the window, and mock audio is marked as simulated.

**Audio visual:** use the *same* SashaTel Particle Field vocabulary as the brandbook's call mode; a compact micro-particle neural ring is permissible. It may respond to measured audio energy; the HTML demo uses synthetic syllable-like movement, never a real recording or audio stream. Do not stack an additional SoundCloud-style waveform. Reduced motion produces a stable ring.

**Icon decisions:** reuse the original telephony app's `settings` SVG geometry as the standard, not the malformed approximated gear. Contact uses consistent address-book / person-card shape. Approved operations include `trash-2` (delete with confirmation), `plus` (add), `square` and `square-check` illustrations, `check`, `phone-incoming`, `phone-outgoing`, `grid-3x3`, `mic`, `mic-off`, `pause`, `volume-2`. For actual selections use native semantic HTML `<input type="checkbox">` with programmatic checked state and keyboard support, not just a painted icon.

**Profile utilities in analytics:** the date-range selector and compact theme switch must be visible in the **same utility row as notifications and the account chip**, not only in the brandbook's global navigation. Keep the date range next to the account chip as the toolbar adapts.

**Acceptance steps:** replay first launch, reach authorization, verify empty-field validation, connect the simulated line and open the dialer; open the softphone; enter/edit a number; switch history/settings; place a simulated call; observe connecting, ringing, active and terminating; verify the timer threshold and pending-end lock; verify failed and cancelled calls, history refresh and redial, and audio errors. Test keyboard focus, narrow widths and reduced motion. Do not call this production ready without a native macOS/electron test and accessibility review.


## 13. Acceptance criteria for future product work

1. Start with the user action and its operating context. Sketch the primary, waiting, success, blocked and recovery states before choosing treatments. Each state has one dominant visual plane and one primary action.
2. Use the existing typography, grid, icon and color roles. Show which part of the reference you are borrowing and which SashaTel interaction it serves. Distinctiveness comes from the particle motion and typographic hierarchy, not extra frames, badges or chrome.
3. Keep the accent concentrated. Use Signal #E8C547 for active feedback on dark, Mustard #AA843D for a restrained data accent, and Ochre #765A25 on light. Success uses #39C985 dark / #168353 light. Error uses #E86A71 dark / #BD3647 light. Every status must also have a text or icon cue. Chart proportions come from the data. One complete category may use Mustard or Ochre, with the same color in its legend. Keep the original category proportions.
4. Check rendered work in both themes. Normal text targets 4.5:1 contrast and meaningful controls and chart strokes target 3:1 against their composed surroundings. Inspect real Cyrillic, numbers, labels, disabled markers and focus.
5. Review a working build with desktop and narrow screenshots, and exercise primary and recovery paths by mouse and keyboard. Check reduced motion. For native work run on macOS and verify authorization return, permissions and the title bar. Record viewport, browser or OS and what still needs checking. Static mockups and integrations with simulated behavior must carry that label.

**Web Particle Field themes:** On dark, use warm glows and bright neutral particles. On light, redraw with graphite #25241F and Ochre #765A25, with a light surrounding surface and a graphite caption. Apply the color change to a static frame under reduced motion as well.

**First-run handoff:** Replay opens the initial scene and rebuilds the particle volume. After Launch, keep the same particle simulation. Start each zoom from the current scale. Ready doubles the field and lets it drift beyond the right edge. End first run at Ready. Warm particles lift off the field and drift past the edge of the window. The phone remains available as a standalone specimen in the brandbook. Reduced motion renders a still field.

**Phone entry and live audio:** Center the dialing field. A leading 8 selects +7. National digits typed from an empty field appear inside the +7 mask. Request microphone access only when the user starts a test. Derive the meter from the selected input, with quick attack and a short release. Stop the microphone on leaving the audio panel. The browser uses its current output for the test tone.
