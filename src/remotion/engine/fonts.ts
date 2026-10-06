import { loadFont as loadCustomFont } from "@remotion/fonts";

/**
 * Font loading for the curated Google fonts (dynamic imports keep the bundle small) and uploaded
 * brand fonts. Callers wrap this in delayRender so no frame renders before fonts are ready.
 */

type GoogleFontModule = {
  loadFont: (style?: string, options?: Record<string, unknown>) => { fontFamily: string; waitUntilDone: () => Promise<unknown> };
  getInfo?: () => { fonts: Record<string, Record<string, Record<string, string>>> };
};

const GOOGLE: Record<string, () => Promise<GoogleFontModule>> = {
  Inter: () => import("@remotion/google-fonts/Inter") as Promise<GoogleFontModule>,
  Geist: () => import("@remotion/google-fonts/Geist") as Promise<GoogleFontModule>,
  Manrope: () => import("@remotion/google-fonts/Manrope") as Promise<GoogleFontModule>,
  "Plus Jakarta Sans": () => import("@remotion/google-fonts/PlusJakartaSans") as Promise<GoogleFontModule>,
  "DM Sans": () => import("@remotion/google-fonts/DMSans") as Promise<GoogleFontModule>,
  Figtree: () => import("@remotion/google-fonts/Figtree") as Promise<GoogleFontModule>,
  Onest: () => import("@remotion/google-fonts/Onest") as Promise<GoogleFontModule>,
  "Space Grotesk": () => import("@remotion/google-fonts/SpaceGrotesk") as Promise<GoogleFontModule>,
  Sora: () => import("@remotion/google-fonts/Sora") as Promise<GoogleFontModule>,
  Outfit: () => import("@remotion/google-fonts/Outfit") as Promise<GoogleFontModule>,
  Urbanist: () => import("@remotion/google-fonts/Urbanist") as Promise<GoogleFontModule>,
  Lexend: () => import("@remotion/google-fonts/Lexend") as Promise<GoogleFontModule>,
  Poppins: () => import("@remotion/google-fonts/Poppins") as Promise<GoogleFontModule>,
  Nunito: () => import("@remotion/google-fonts/Nunito") as Promise<GoogleFontModule>,
  Montserrat: () => import("@remotion/google-fonts/Montserrat") as Promise<GoogleFontModule>,
  Raleway: () => import("@remotion/google-fonts/Raleway") as Promise<GoogleFontModule>,
  Rubik: () => import("@remotion/google-fonts/Rubik") as Promise<GoogleFontModule>,
  "Work Sans": () => import("@remotion/google-fonts/WorkSans") as Promise<GoogleFontModule>,
  Archivo: () => import("@remotion/google-fonts/Archivo") as Promise<GoogleFontModule>,
  "IBM Plex Sans": () => import("@remotion/google-fonts/IBMPlexSans") as Promise<GoogleFontModule>,
  Syne: () => import("@remotion/google-fonts/Syne") as Promise<GoogleFontModule>,
  Mulish: () => import("@remotion/google-fonts/Mulish") as Promise<GoogleFontModule>,
  "Bricolage Grotesque": () => import("@remotion/google-fonts/BricolageGrotesque") as Promise<GoogleFontModule>,
  "Playfair Display": () => import("@remotion/google-fonts/PlayfairDisplay") as Promise<GoogleFontModule>,
  "Instrument Serif": () => import("@remotion/google-fonts/InstrumentSerif") as Promise<GoogleFontModule>,
  "DM Serif Display": () => import("@remotion/google-fonts/DMSerifDisplay") as Promise<GoogleFontModule>,
  Fraunces: () => import("@remotion/google-fonts/Fraunces") as Promise<GoogleFontModule>,
  "JetBrains Mono": () => import("@remotion/google-fonts/JetBrainsMono") as Promise<GoogleFontModule>,
  "Nothing You Could Do": () => import("@remotion/google-fonts/NothingYouCouldDo") as Promise<GoogleFontModule>,
};

const SERIF = new Set(["Playfair Display", "Instrument Serif", "DM Serif Display", "Fraunces"]);
const HANDWRITING = new Set(["Nothing You Could Do"]);
const WANTED_WEIGHTS = ["400", "500", "600", "700", "800"];
const cache = new Map<string, Promise<void>>();

export function fontStack(name: string): string {
  if (name === "JetBrains Mono") return `"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace`;
  if (HANDWRITING.has(name)) return `"${name}", "Segoe Print", "Bradley Hand", cursive`;
  return `"${name}", ${SERIF.has(name) ? "Georgia, 'Times New Roman', serif" : "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"}`;
}

export function loadGoogleFont(name: string): Promise<void> {
  const existing = cache.get(name);
  if (existing) return existing;
  const loader = GOOGLE[name];
  const promise = loader
    ? loader()
        .then(async (mod) => {
          const available = mod.getInfo ? Object.keys(mod.getInfo().fonts.normal ?? {}) : null;
          const weights = available ? WANTED_WEIGHTS.filter((w) => available.includes(w)) : undefined;
          const { waitUntilDone } = mod.loadFont("normal", { ...(weights && weights.length ? { weights } : {}), subsets: ["latin"], ignoreTooManyRequestsWarning: true });
          await waitUntilDone();
        })
        .catch((err) => {
          console.warn(`[motion-studio] font "${name}" failed to load`, err);
        })
    : Promise.resolve();
  cache.set(name, promise);
  return promise;
}

export function loadBrandFont(family: string, url: string): Promise<void> {
  const key = `custom:${family}:${url}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const promise = loadCustomFont({ family, url })
    .then(() => undefined)
    .catch((err) => console.warn(`[motion-studio] brand font "${family}" failed to load`, err));
  cache.set(key, promise);
  return promise;
}

export function isCuratedFont(name: string): boolean {
  return name in GOOGLE;
}
