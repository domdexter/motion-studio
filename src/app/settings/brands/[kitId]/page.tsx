import type { Metadata } from "next";
import { BrandKitEditorView } from "@/components/studio/settings/brand-kits";

export const metadata: Metadata = { title: "Brand kit" };

export default async function BrandKitPage({ params }: { params: Promise<{ kitId: string }> }) {
  const { kitId } = await params;
  return <BrandKitEditorView kitId={kitId} />;
}
